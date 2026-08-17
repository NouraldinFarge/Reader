// Reader is a GUI application in every Windows build profile. Keeping this
// unconditional prevents a console window even when a locally built binary is
// launched directly instead of through an installed release shortcut.
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    reader_lib::run();
}
