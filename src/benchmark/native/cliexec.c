// cliexec: runs one command and reports what it cost, for the benchmark's one-shot CLI suite.
//
// Node cannot measure a short-lived child precisely: it learns of the exit through its event loop,
// and libuv reaps the child at once, so the kernel's counters for it (peak footprint, CPU,
// instructions) are gone before any sampler can read them. This helper posix_spawns the command,
// waits for it to exit WITHOUT reaping it (waitid WNOWAIT), reads the zombie's rusage_info, and
// only then reaps it with wait4 (whose rusage also covers descendants the command reaped itself).
// It is what `/usr/bin/time -l` does, with nanosecond wall time instead of 10 ms.
//
// Usage:  cliexec <result.json> <cmd> [args...]
//         The environment, working directory and stdin/stdout/stderr pass straight through; no
//         other descriptor is inherited. The result is one JSON object written to <result.json>.
//         Exit status: 0 when the measurement worked (whatever the command's own status), 64 on a
//         usage error, 70 when the command could not be spawned or measured.
//
// Build: cc -O2 -Wall -o <ws>/builds/bin/cliexec native/cliexec.c

#include <errno.h>
#include <libproc.h>
#include <mach/mach_time.h>
#include <signal.h>
#include <spawn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;

static mach_timebase_info_data_t tb;

static uint64_t ticks_to_ns(uint64_t t) {
  return (uint64_t)(((__uint128_t)t * tb.numer) / tb.denom);
}

static int write_error(const char *out, const char *what, int err) {
  FILE *f = fopen(out, "w");
  if (f) {
    fprintf(f, "{\"ok\":false,\"error\":\"%s: %s\"}\n", what, strerror(err));
    fclose(f);
  }
  fprintf(stderr, "cliexec: %s: %s\n", what, strerror(err));
  return 70;
}

int main(int argc, char **argv) {
  if (argc < 3) {
    fprintf(stderr, "usage: cliexec <result.json> <cmd> [args...]\n");
    return 64;
  }
  const char *out = argv[1];
  mach_timebase_info(&tb);

  posix_spawnattr_t attr;
  posix_spawn_file_actions_t fa;
  posix_spawnattr_init(&attr);
  posix_spawn_file_actions_init(&fa);
  // Only stdin/stdout/stderr reach the command, so no descriptor of the harness can keep a pipe
  // open or change what the command sees.
  short flags = POSIX_SPAWN_CLOEXEC_DEFAULT | POSIX_SPAWN_SETSIGMASK | POSIX_SPAWN_SETSIGDEF;
  posix_spawnattr_setflags(&attr, flags);
  sigset_t none, dfl;
  sigemptyset(&none);
  posix_spawnattr_setsigmask(&attr, &none);
  sigemptyset(&dfl);
  sigaddset(&dfl, SIGINT);
  sigaddset(&dfl, SIGTERM);
  sigaddset(&dfl, SIGPIPE);
  sigaddset(&dfl, SIGCHLD);
  posix_spawnattr_setsigdefault(&attr, &dfl);
  for (int fd = 0; fd <= 2; fd++) posix_spawn_file_actions_addinherit_np(&fa, fd);

  pid_t pid = 0;
  uint64_t t0 = mach_absolute_time();
  int rc = posix_spawn(&pid, argv[2], &fa, &attr, &argv[2], environ);
  uint64_t t_spawned = mach_absolute_time();
  posix_spawn_file_actions_destroy(&fa);
  posix_spawnattr_destroy(&attr);
  if (rc != 0) return write_error(out, "posix_spawn", rc);

  // Wait for the exit but leave the zombie in place: its rusage_info is only readable until reaped.
  siginfo_t si;
  memset(&si, 0, sizeof si);
  while (waitid(P_PID, (id_t)pid, &si, WEXITED | WNOWAIT) != 0) {
    if (errno != EINTR) return write_error(out, "waitid", errno);
  }
  uint64_t t1 = mach_absolute_time();

  struct rusage_info_v4 ri;
  memset(&ri, 0, sizeof ri);
  int rurc = proc_pid_rusage(pid, RUSAGE_INFO_V4, (rusage_info_t *)&ri);
  int ruerr = rurc == 0 ? 0 : errno;

  int status = 0;
  struct rusage ru;
  memset(&ru, 0, sizeof ru);
  while (wait4(pid, &status, 0, &ru) < 0) {
    if (errno != EINTR) return write_error(out, "wait4", errno);
  }

  FILE *f = fopen(out, "w");
  if (!f) {
    fprintf(stderr, "cliexec: cannot write %s: %s\n", out, strerror(errno));
    return 70;
  }
  char code[16] = "null", sig[16] = "null";
  if (WIFEXITED(status)) snprintf(code, sizeof code, "%d", WEXITSTATUS(status));
  if (WIFSIGNALED(status)) snprintf(sig, sizeof sig, "%d", WTERMSIG(status));
  uint64_t life = ri.ri_proc_exit_abstime > ri.ri_proc_start_abstime
                      ? ticks_to_ns(ri.ri_proc_exit_abstime - ri.ri_proc_start_abstime)
                      : 0;
  fprintf(f,
          "{\"ok\":true,\"pid\":%d,\"exit_code\":%s,\"signal\":%s,"
          "\"wall_ns\":%llu,\"spawn_ns\":%llu,\"life_ns\":%llu,"
          "\"rusage_ok\":%s,\"rusage_err\":%d,"
          "\"peak_footprint\":%llu,\"footprint_at_exit\":%llu,"
          "\"user_ns\":%llu,\"system_ns\":%llu,\"child_user_ns\":%llu,\"child_system_ns\":%llu,"
          "\"wait4_user_us\":%lld,\"wait4_system_us\":%lld,\"max_rss\":%ld,"
          "\"instructions\":%llu,\"cycles\":%llu,"
          "\"pkg_idle_wkups\":%llu,\"interrupt_wkups\":%llu,\"pageins\":%llu,"
          "\"diskio_read\":%llu,\"diskio_written\":%llu}\n",
          pid, code, sig, (unsigned long long)ticks_to_ns(t1 - t0),
          (unsigned long long)ticks_to_ns(t_spawned - t0), (unsigned long long)life,
          rurc == 0 ? "true" : "false", ruerr,
          (unsigned long long)ri.ri_lifetime_max_phys_footprint,
          (unsigned long long)ri.ri_phys_footprint, (unsigned long long)ticks_to_ns(ri.ri_user_time),
          (unsigned long long)ticks_to_ns(ri.ri_system_time),
          (unsigned long long)ticks_to_ns(ri.ri_child_user_time),
          (unsigned long long)ticks_to_ns(ri.ri_child_system_time),
          (long long)ru.ru_utime.tv_sec * 1000000LL + ru.ru_utime.tv_usec,
          (long long)ru.ru_stime.tv_sec * 1000000LL + ru.ru_stime.tv_usec, (long)ru.ru_maxrss,
          (unsigned long long)ri.ri_instructions, (unsigned long long)ri.ri_cycles,
          (unsigned long long)ri.ri_pkg_idle_wkups, (unsigned long long)ri.ri_interrupt_wkups,
          (unsigned long long)ri.ri_pageins, (unsigned long long)ri.ri_diskio_bytesread,
          (unsigned long long)ri.ri_diskio_byteswritten);
  fclose(f);
  return 0;
}
