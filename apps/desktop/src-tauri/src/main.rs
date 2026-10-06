//! Nary desktop binary entry point.

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

fn main() {
    nary_desktop_lib::run()
}
