// procstat: a persistent process-statistics helper for the Tendril benchmark harness.
//
// Node has no API for another process's memory or CPU counters, and shelling out to `ps`,
// `footprint` or python per sample costs 10-40 ms and forks under the very load we measure. This
// helper stays alive for the whole run and answers one JSON line per command on stdin, so a sample
// of a few dozen pids costs microseconds.
//
// Build: cc -O2 -Wall -o <ws>/builds/bin/procstat native/procstat.c \
//          -framework CoreGraphics -framework CoreFoundation
//
// Protocol (one command per line, one JSON object per line in reply, always flushed):
//   ping                      {"ok":true,"pid":N,"timebase":[numer,denom]}
//   sample <pid>...           {"t_ns":N,"procs":[{pid,ok,err?,name,phys_footprint,...}]}
//   reset <pid>...            {"ok":[pid...],"failed":[{"pid":N,"err":"ESRCH"}...]}
//   children <pid>            {"pid":N,"children":[pid...]}
//   resp <pid>...             {"resp":[{"pid":N,"responsible":N}...]}   (-1 when unknown)
//   list                      {"procs":[{pid,ppid,pgid,uid,name,start_us}...]}
//   path <pid>...             {"paths":[{"pid":N,"path":"..."|null}...]}
//   windows [<pid>...]        {"windows":[{pid,id,layer,x,y,w,h,onscreen,owner}...]}  on-screen only
//   windows-all [<pid>...]    same, but every window the window server knows (onscreen flag set)
//   quit                      exits
// Unknown or malformed commands reply {"error":"..."} so the reader never falls out of step.

#include <CoreFoundation/CoreFoundation.h>
#include <CoreGraphics/CoreGraphics.h>
#include <errno.h>
#include <libproc.h>
#include <mach/mach_time.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc_info.h>
#include <sys/resource.h>
#include <unistd.h>

// Both are exported by libSystem but absent from the public headers.
extern int proc_reset_footprint_interval(pid_t pid);
extern pid_t responsibility_get_pid_responsible_for_pid(pid_t pid);

static mach_timebase_info_data_t tb;

static uint64_t ticks_to_ns(uint64_t t) {
  // rusage CPU times are mach ticks on arm64 (125/3 ns per tick here); 128-bit keeps long-lived
  // processes from overflowing the multiplication.
  return (uint64_t)(((__uint128_t)t * tb.numer) / tb.denom);
}

// ---------------------------------------------------------------------------------------------
// Growable output buffer. Every reply is assembled here and written with a single fwrite, so a
// reader never sees a partial line.

typedef struct {
  char *p;
  size_t len, cap;
} sbuf;

static void sb_reserve(sbuf *b, size_t extra) {
  if (b->len + extra + 1 <= b->cap) return;
  size_t cap = b->cap ? b->cap : 4096;
  while (b->len + extra + 1 > cap) cap *= 2;
  char *np = realloc(b->p, cap);
  if (!np) {
    fputs("{\"error\":\"out of memory\"}\n", stdout);
    fflush(stdout);
    exit(2);
  }
  b->p = np;
  b->cap = cap;
}

static void sb_printf(sbuf *b, const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  va_list ap2;
  va_copy(ap2, ap);
  int n = vsnprintf(NULL, 0, fmt, ap);
  va_end(ap);
  if (n < 0) {
    va_end(ap2);
    return;
  }
  sb_reserve(b, (size_t)n);
  vsnprintf(b->p + b->len, b->cap - b->len, fmt, ap2);
  va_end(ap2);
  b->len += (size_t)n;
}

static void sb_puts(sbuf *b, const char *s) {
  size_t n = strlen(s);
  sb_reserve(b, n);
  memcpy(b->p + b->len, s, n);
  b->len += n;
  b->p[b->len] = 0;
}

// Process names and paths are arbitrary bytes; escape anything JSON cannot carry raw.
static void sb_json_str(sbuf *b, const char *s, size_t n) {
  sb_puts(b, "\"");
  for (size_t i = 0; i < n && s[i]; i++) {
    unsigned char c = (unsigned char)s[i];
    if (c == '"' || c == '\\') {
      sb_printf(b, "\\%c", c);
    } else if (c < 0x20 || c == 0x7f) {
      sb_printf(b, "\\u%04x", c);
    } else {
      sb_reserve(b, 1);
      b->p[b->len++] = (char)c;
      b->p[b->len] = 0;
    }
  }
  sb_puts(b, "\"");
}

static void emit(sbuf *b) {
  sb_puts(b, "\n");
  fwrite(b->p, 1, b->len, stdout);
  fflush(stdout);
  b->len = 0;
  if (b->p) b->p[0] = 0;
}

static const char *errname(int e) {
  switch (e) {
    case ESRCH: return "ESRCH";
    case EPERM: return "EPERM";
    case EINVAL: return "EINVAL";
    case EACCES: return "EACCES";
    case ENOMEM: return "ENOMEM";
    default: return NULL;
  }
}

static void sb_err(sbuf *b, int e) {
  const char *n = errname(e);
  if (n) sb_printf(b, "\"%s\"", n);
  else sb_printf(b, "\"errno %d\"", e);
}

// ---------------------------------------------------------------------------------------------
// Argument parsing

#define MAX_ARGS 4096

static int parse_pids(char *rest, pid_t *out, int max, const char **bad) {
  int n = 0;
  char *save = NULL;
  for (char *tok = strtok_r(rest, " \t\r\n", &save); tok; tok = strtok_r(NULL, " \t\r\n", &save)) {
    char *end = NULL;
    long v = strtol(tok, &end, 10);
    if (!end || *end != 0 || v < 0 || v > INT32_MAX) {
      *bad = tok;
      return -1;
    }
    if (n >= max) {
      *bad = "too many pids";
      return -1;
    }
    out[n++] = (pid_t)v;
  }
  return n;
}

// ---------------------------------------------------------------------------------------------
// Commands

static void cmd_sample(sbuf *b, pid_t *pids, int n) {
  uint64_t now = ticks_to_ns(mach_absolute_time());
  sb_printf(b, "{\"t_ns\":%llu,\"procs\":[", (unsigned long long)now);
  for (int i = 0; i < n; i++) {
    if (i) sb_puts(b, ",");
    struct rusage_info_v4 ri;
    memset(&ri, 0, sizeof ri);
    int rc = proc_pid_rusage(pids[i], RUSAGE_INFO_V4, (rusage_info_t *)&ri);
    if (rc != 0) {
      int e = errno;
      sb_printf(b, "{\"pid\":%d,\"ok\":false,\"err\":", pids[i]);
      sb_err(b, e);
      sb_puts(b, "}");
      continue;
    }
    char name[2 * MAXCOMLEN + 1];
    memset(name, 0, sizeof name);
    proc_name(pids[i], name, sizeof name - 1);
    sb_printf(b, "{\"pid\":%d,\"ok\":true,\"name\":", pids[i]);
    sb_json_str(b, name, sizeof name);
    uint64_t user_ns = ticks_to_ns(ri.ri_user_time);
    uint64_t sys_ns = ticks_to_ns(ri.ri_system_time);
    sb_printf(b,
              ",\"phys_footprint\":%llu,\"lifetime_max_footprint\":%llu,"
              "\"interval_max_footprint\":%llu,\"resident\":%llu,\"wired\":%llu,"
              "\"cpu_ns\":%llu,\"user_ns\":%llu,\"system_ns\":%llu,"
              "\"pkg_idle_wkups\":%llu,\"interrupt_wkups\":%llu,\"pageins\":%llu,"
              "\"diskio_read\":%llu,\"diskio_written\":%llu,\"logical_writes\":%llu,"
              "\"instructions\":%llu,\"cycles\":%llu,\"billed_energy_nj\":%llu,"
              "\"runnable_ns\":%llu,\"start_ns\":%llu,\"exit_ns\":%llu}",
              (unsigned long long)ri.ri_phys_footprint,
              (unsigned long long)ri.ri_lifetime_max_phys_footprint,
              (unsigned long long)ri.ri_interval_max_phys_footprint,
              (unsigned long long)ri.ri_resident_size, (unsigned long long)ri.ri_wired_size,
              (unsigned long long)(user_ns + sys_ns), (unsigned long long)user_ns,
              (unsigned long long)sys_ns, (unsigned long long)ri.ri_pkg_idle_wkups,
              (unsigned long long)ri.ri_interrupt_wkups, (unsigned long long)ri.ri_pageins,
              (unsigned long long)ri.ri_diskio_bytesread,
              (unsigned long long)ri.ri_diskio_byteswritten,
              (unsigned long long)ri.ri_logical_writes, (unsigned long long)ri.ri_instructions,
              (unsigned long long)ri.ri_cycles, (unsigned long long)ri.ri_billed_energy,
              (unsigned long long)ticks_to_ns(ri.ri_runnable_time),
              (unsigned long long)ticks_to_ns(ri.ri_proc_start_abstime),
              (unsigned long long)(ri.ri_proc_exit_abstime ? ticks_to_ns(ri.ri_proc_exit_abstime)
                                                           : 0));
  }
  sb_puts(b, "]}");
}

static void cmd_reset(sbuf *b, pid_t *pids, int n) {
  sbuf failed = {0};
  sb_puts(&failed, "");
  sb_puts(b, "{\"ok\":[");
  int nok = 0, nfail = 0;
  for (int i = 0; i < n; i++) {
    errno = 0;
    int rc = proc_reset_footprint_interval(pids[i]);
    if (rc == 0) {
      sb_printf(b, "%s%d", nok++ ? "," : "", pids[i]);
    } else {
      int e = errno ? errno : EINVAL;
      sb_printf(&failed, "%s{\"pid\":%d,\"err\":", nfail++ ? "," : "", pids[i]);
      sb_err(&failed, e);
      sb_puts(&failed, "}");
    }
  }
  sb_puts(b, "],\"failed\":[");
  sb_puts(b, failed.p ? failed.p : "");
  sb_puts(b, "]}");
  free(failed.p);
}

static int list_children(pid_t pid, pid_t **out) {
  int cap = 256;
  for (;;) {
    pid_t *buf = calloc((size_t)cap, sizeof(pid_t));
    if (!buf) return -1;
    // Returns a count of pids (libproc divides the byte count for us).
    int n = proc_listchildpids(pid, buf, cap * (int)sizeof(pid_t));
    if (n < 0) {
      free(buf);
      return -1;
    }
    if (n < cap) {
      *out = buf;
      return n;
    }
    free(buf);
    cap *= 4;
  }
}

static void cmd_children(sbuf *b, pid_t pid) {
  pid_t *kids = NULL;
  int n = list_children(pid, &kids);
  int e = errno;
  sb_printf(b, "{\"pid\":%d,\"children\":[", pid);
  int first = 1;
  for (int i = 0; i < n; i++) {
    if (kids[i] <= 0) continue;
    sb_printf(b, "%s%d", first ? "" : ",", kids[i]);
    first = 0;
  }
  sb_puts(b, "]");
  if (n < 0) {
    sb_puts(b, ",\"err\":");
    sb_err(b, e);
  }
  sb_puts(b, "}");
  free(kids);
}

static void cmd_resp(sbuf *b, pid_t *pids, int n) {
  sb_puts(b, "{\"resp\":[");
  for (int i = 0; i < n; i++) {
    pid_t r = responsibility_get_pid_responsible_for_pid(pids[i]);
    sb_printf(b, "%s{\"pid\":%d,\"responsible\":%d}", i ? "," : "", pids[i], r > 0 ? r : -1);
  }
  sb_puts(b, "]}");
}

static void cmd_list(sbuf *b) {
  int cap = 4096;
  pid_t *buf = NULL;
  int n = 0;
  for (;;) {
    buf = calloc((size_t)cap, sizeof(pid_t));
    if (!buf) {
      sb_puts(b, "{\"error\":\"out of memory\"}");
      return;
    }
    n = proc_listallpids(buf, cap * (int)sizeof(pid_t));
    if (n < 0) {
      free(buf);
      sb_puts(b, "{\"error\":");
      sb_err(b, errno);
      sb_puts(b, "}");
      return;
    }
    if (n < cap) break;
    free(buf);
    cap *= 2;
  }
  sb_puts(b, "{\"procs\":[");
  int first = 1;
  for (int i = 0; i < n; i++) {
    pid_t pid = buf[i];
    if (pid < 0) continue;
    struct proc_bsdinfo bi;
    memset(&bi, 0, sizeof bi);
    int got = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &bi, sizeof bi);
    if (got == (int)sizeof bi) {
      const char *nm = bi.pbi_name[0] ? bi.pbi_name : bi.pbi_comm;
      size_t nmax = bi.pbi_name[0] ? sizeof bi.pbi_name : sizeof bi.pbi_comm;
      sb_printf(b, "%s{\"pid\":%d,\"ppid\":%u,\"pgid\":%u,\"uid\":%u,\"name\":", first ? "" : ",",
                pid, bi.pbi_ppid, bi.pbi_pgid, bi.pbi_uid);
      sb_json_str(b, nm, nmax);
      sb_printf(b, ",\"start_us\":%llu}",
                (unsigned long long)(bi.pbi_start_tvsec * 1000000ULL + bi.pbi_start_tvusec));
      first = 0;
      continue;
    }
    // Full BSD info is refused for some system processes; the short form still has the tree.
    struct proc_bsdshortinfo si;
    memset(&si, 0, sizeof si);
    got = proc_pidinfo(pid, PROC_PIDT_SHORTBSDINFO, 0, &si, sizeof si);
    if (got == (int)sizeof si) {
      sb_printf(b, "%s{\"pid\":%d,\"ppid\":%u,\"pgid\":%u,\"uid\":%u,\"name\":", first ? "" : ",",
                pid, si.pbsi_ppid, si.pbsi_pgid, si.pbsi_uid);
      sb_json_str(b, si.pbsi_comm, sizeof si.pbsi_comm);
      sb_puts(b, ",\"start_us\":null}");
      first = 0;
    }
  }
  sb_puts(b, "]}");
  free(buf);
}

static void cmd_path(sbuf *b, pid_t *pids, int n) {
  sb_puts(b, "{\"paths\":[");
  for (int i = 0; i < n; i++) {
    char path[PROC_PIDPATHINFO_MAXSIZE];
    int len = proc_pidpath(pids[i], path, sizeof path);
    sb_printf(b, "%s{\"pid\":%d,\"path\":", i ? "," : "", pids[i]);
    if (len > 0) sb_json_str(b, path, (size_t)len);
    else sb_puts(b, "null");
    sb_puts(b, "}");
  }
  sb_puts(b, "]}");
}

static int cfnum_int(CFDictionaryRef d, CFStringRef key, long long *out) {
  CFNumberRef v = CFDictionaryGetValue(d, key);
  if (!v || CFGetTypeID(v) != CFNumberGetTypeID()) return 0;
  return CFNumberGetValue(v, kCFNumberLongLongType, out) ? 1 : 0;
}

static void cmd_windows(sbuf *b, pid_t *pids, int n, int all) {
  CGWindowListOption opt = all ? kCGWindowListOptionAll : kCGWindowListOptionOnScreenOnly;
  CFArrayRef arr = CGWindowListCopyWindowInfo(opt, kCGNullWindowID);
  sb_puts(b, "{\"windows\":[");
  if (!arr) {
    sb_puts(b, "],\"error\":\"CGWindowListCopyWindowInfo returned NULL\"}");
    return;
  }
  int first = 1;
  CFIndex count = CFArrayGetCount(arr);
  for (CFIndex i = 0; i < count; i++) {
    CFDictionaryRef w = CFArrayGetValueAtIndex(arr, i);
    long long owner = -1, id = -1, layer = 0;
    cfnum_int(w, kCGWindowOwnerPID, &owner);
    if (n > 0) {
      int match = 0;
      for (int k = 0; k < n; k++)
        if (pids[k] == owner) match = 1;
      if (!match) continue;
    }
    cfnum_int(w, kCGWindowNumber, &id);
    cfnum_int(w, kCGWindowLayer, &layer);
    CGRect r = CGRectZero;
    CFDictionaryRef bounds = CFDictionaryGetValue(w, kCGWindowBounds);
    if (bounds) CGRectMakeWithDictionaryRepresentation(bounds, &r);
    CFBooleanRef on = CFDictionaryGetValue(w, kCGWindowIsOnscreen);
    int onscreen = on ? CFBooleanGetValue(on) : 0;
    char ownerName[256] = {0};
    CFStringRef on_s = CFDictionaryGetValue(w, kCGWindowOwnerName);
    if (on_s) CFStringGetCString(on_s, ownerName, sizeof ownerName, kCFStringEncodingUTF8);
    sb_printf(b,
              "%s{\"pid\":%lld,\"id\":%lld,\"layer\":%lld,\"x\":%.0f,\"y\":%.0f,\"w\":%.0f,"
              "\"h\":%.0f,\"onscreen\":%s,\"owner\":",
              first ? "" : ",", owner, id, layer, r.origin.x, r.origin.y, r.size.width,
              r.size.height, onscreen ? "true" : "false");
    sb_json_str(b, ownerName, sizeof ownerName);
    sb_puts(b, "}");
    first = 0;
  }
  CFRelease(arr);
  sb_puts(b, "]}");
}

// ---------------------------------------------------------------------------------------------

int main(void) {
  mach_timebase_info(&tb);
  static char line[1 << 16];
  static pid_t pids[MAX_ARGS];
  sbuf b = {0};
  sb_puts(&b, "");
  b.len = 0;

  while (fgets(line, sizeof line, stdin)) {
    char *save = NULL;
    char *cmd = strtok_r(line, " \t\r\n", &save);
    if (!cmd) {
      sb_puts(&b, "{\"error\":\"empty command\"}");
      emit(&b);
      continue;
    }
    char *rest = save ? save : "";
    const char *bad = NULL;

    if (strcmp(cmd, "quit") == 0) break;

    if (strcmp(cmd, "ping") == 0) {
      sb_printf(&b, "{\"ok\":true,\"pid\":%d,\"timebase\":[%u,%u]}", getpid(), tb.numer, tb.denom);
      emit(&b);
      continue;
    }
    if (strcmp(cmd, "list") == 0) {
      cmd_list(&b);
      emit(&b);
      continue;
    }

    int n = parse_pids(rest, pids, MAX_ARGS, &bad);
    if (n < 0) {
      sb_puts(&b, "{\"error\":\"bad pid argument\",\"arg\":");
      sb_json_str(&b, bad, strlen(bad));
      sb_puts(&b, "}");
      emit(&b);
      continue;
    }

    if (strcmp(cmd, "sample") == 0) {
      cmd_sample(&b, pids, n);
    } else if (strcmp(cmd, "reset") == 0) {
      cmd_reset(&b, pids, n);
    } else if (strcmp(cmd, "children") == 0) {
      if (n != 1) sb_puts(&b, "{\"error\":\"children takes exactly one pid\"}");
      else cmd_children(&b, pids[0]);
    } else if (strcmp(cmd, "resp") == 0) {
      cmd_resp(&b, pids, n);
    } else if (strcmp(cmd, "path") == 0) {
      cmd_path(&b, pids, n);
    } else if (strcmp(cmd, "windows") == 0) {
      cmd_windows(&b, pids, n, 0);
    } else if (strcmp(cmd, "windows-all") == 0) {
      cmd_windows(&b, pids, n, 1);
    } else {
      sb_puts(&b, "{\"error\":\"unknown command\",\"command\":");
      sb_json_str(&b, cmd, strlen(cmd));
      sb_puts(&b, "}");
    }
    emit(&b);
  }
  free(b.p);
  return 0;
}
