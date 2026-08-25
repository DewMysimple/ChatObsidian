use crate::error::{AppResult, message};
use std::ffi::c_void;
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
};
use windows::Win32::UI::Shell::{IVirtualDesktopManager, VirtualDesktopManager};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetForegroundWindow, GetWindowRect, GetWindowTextLengthW, GetWindowTextW,
    IsWindowVisible, PostMessageW, SW_RESTORE, SetForegroundWindow, ShowWindowAsync, WM_CLOSE,
};
use windows::core::{BOOL, GUID};

#[derive(Debug, Clone)]
pub struct ObsidianWindow {
    pub hwnd: isize,
    pub title: String,
    pub area: i64,
}

struct ComGuard;

impl ComGuard {
    fn initialize() -> AppResult<Self> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok() }
            .map_err(|error| message(format!("无法初始化 Windows 虚拟桌面接口：{error}")))?;
        Ok(Self)
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

fn manager() -> AppResult<(ComGuard, IVirtualDesktopManager)> {
    let guard = ComGuard::initialize()?;
    let manager = unsafe { CoCreateInstance(&VirtualDesktopManager, None, CLSCTX_ALL) }
        .map_err(|error| message(format!("无法连接 Windows 虚拟桌面：{error}")))?;
    Ok((guard, manager))
}

pub fn desktop_id(hwnd: isize) -> AppResult<GUID> {
    let (_guard, manager) = manager()?;
    unsafe { manager.GetWindowDesktopId(HWND(hwnd as *mut c_void)) }
        .map_err(|error| message(format!("无法读取窗口所在桌面：{error}")))
}

pub fn move_to_desktop(hwnd: isize, desktop_id: &GUID) -> AppResult<()> {
    let (_guard, manager) = manager()?;
    unsafe { manager.MoveWindowToDesktop(HWND(hwnd as *mut c_void), desktop_id) }
        .map_err(|error| message(format!("无法移动窗口到当前桌面：{error}")))
}

pub fn move_to_foreground_desktop(hwnd: isize) -> AppResult<()> {
    let foreground = unsafe { GetForegroundWindow() };
    if foreground.0.is_null() || foreground.0 as isize == hwnd {
        return Ok(());
    }
    let target = desktop_id(foreground.0 as isize)?;
    move_to_desktop(hwnd, &target)
}

pub fn obsidian_windows() -> Vec<ObsidianWindow> {
    let mut windows = Vec::<ObsidianWindow>::new();
    unsafe {
        let _ = EnumWindows(
            Some(enum_window),
            LPARAM((&mut windows as *mut Vec<ObsidianWindow>) as isize),
        );
    }
    windows
}

unsafe extern "system" fn enum_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    if !unsafe { IsWindowVisible(hwnd) }.as_bool() {
        return BOOL(1);
    }
    let length = unsafe { GetWindowTextLengthW(hwnd) };
    if length <= 0 {
        return BOOL(1);
    }
    let mut buffer = vec![0u16; length as usize + 1];
    let copied = unsafe { GetWindowTextW(hwnd, &mut buffer) };
    let title = String::from_utf16_lossy(&buffer[..copied.max(0) as usize]);
    if !title.contains(" - Obsidian ") {
        return BOOL(1);
    }
    let mut rect = RECT::default();
    let area = if unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok() {
        i64::from((rect.right - rect.left).max(0)) * i64::from((rect.bottom - rect.top).max(0))
    } else {
        0
    };
    let windows = unsafe { &mut *(lparam.0 as *mut Vec<ObsidianWindow>) };
    windows.push(ObsidianWindow {
        hwnd: hwnd.0 as isize,
        title,
        area,
    });
    BOOL(1)
}

pub fn matches_vault(title: &str, vault_name: &str) -> bool {
    title.contains(&format!(" - {vault_name} - Obsidian "))
}

pub fn is_on_desktop(window: &ObsidianWindow, target: &GUID) -> bool {
    desktop_id(window.hwnd).is_ok_and(|desktop| desktop == *target)
}

pub fn focus_largest(windows: &[ObsidianWindow]) {
    if let Some(primary) = windows.iter().max_by_key(|window| window.area) {
        let hwnd = HWND(primary.hwnd as *mut c_void);
        unsafe {
            let _ = ShowWindowAsync(hwnd, SW_RESTORE);
            let _ = SetForegroundWindow(hwnd);
        }
    }
}

pub fn focus_window(hwnd: isize) {
    let hwnd = HWND(hwnd as *mut c_void);
    unsafe {
        let _ = ShowWindowAsync(hwnd, SW_RESTORE);
        let _ = SetForegroundWindow(hwnd);
    }
}

pub fn close_windows(windows: &[ObsidianWindow]) -> AppResult<()> {
    for window in windows {
        unsafe {
            PostMessageW(
                Some(HWND(window.hwnd as *mut c_void)),
                WM_CLOSE,
                Default::default(),
                Default::default(),
            )
        }
        .map_err(|error| message(format!("无法正常关闭 Obsidian 窗口：{error}")))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::matches_vault;

    #[test]
    fn matches_exact_vault_segment() {
        assert!(matches_vault(
            "Note - ChatTechStack - Obsidian 1.13.7",
            "ChatTechStack"
        ));
        assert!(!matches_vault(
            "Note - ChatTechStack2 - Obsidian 1.13.7",
            "ChatTechStack"
        ));
    }
}
