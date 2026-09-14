const UNIX_INSTALL_COMMAND = "curl -sSf https://cdn.ivy.app/install-tendril.sh | sh";
const WINDOWS_INSTALL_COMMAND = "irm https://cdn.ivy.app/install-tendril.ps1 | iex";

/** The README's quick-install one-liner for the current platform. */
export const getUpdateCommand = (): string =>
  navigator.platform.toLowerCase().includes("win") ? WINDOWS_INSTALL_COMMAND : UNIX_INSTALL_COMMAND;
