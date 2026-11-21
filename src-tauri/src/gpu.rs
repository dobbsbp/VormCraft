// (Only used on Linux; the reading is tested everywhere.)
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

// Which graphics chips a Linux computer has, and which one VormCraft draws with. WebKitGTK hides
// the real name from the page (WebGL reports a made-up "Apple GPU", against fingerprinting), so the
// shell finds out from Linux itself:
// - the chips: /sys/class/drm/cardN (maker and model numbers, driver, the chip the screen starts
//   on), named from the PCI ID list (pci.ids) or, for Nvidia's own driver, /proc/driver/nvidia;
// - the one in use: the graphics device files WebKit's helper processes (children of this app)
//   have open, from /proc/<pid>/fd and fdinfo. None open means WebKit draws in software.
//
// The reading of each file is kept apart from the walking of /sys and /proc, so it is tested on
// every system.

use std::collections::HashMap;

/// One graphics chip.
#[derive(serde::Serialize, Debug, Clone, PartialEq)]
pub struct Card {
  pub name: String,
  pub driver: String,
  /// Its PCI address, e.g. 0000:00:02.0.
  pub pci: String,
  /// WebKit draws with it.
  pub in_use: bool,
  /// The screen starts on it (usually the built-in chip on a laptop with two).
  pub startup: bool,
}

#[derive(serde::Serialize, Debug)]
pub struct Graphics {
  pub cards: Vec<Card>,
  /// WebKit's helper processes were found, so `in_use` and `software` mean something.
  pub checked: bool,
  /// WebKit has no graphics device open: it draws in software.
  pub software: bool,
}

/// From a device's uevent file: its driver, maker and model numbers, and PCI address.
pub fn parse_uevent(text: &str) -> (Option<String>, Option<(u16, u16)>, Option<String>) {
  let mut driver = None;
  let mut id = None;
  let mut slot = None;
  for line in text.lines() {
    if let Some(v) = line.strip_prefix("DRIVER=") {
      driver = Some(v.trim().to_string());
    } else if let Some(v) = line.strip_prefix("PCI_ID=") {
      let mut p = v.trim().split(':').map(|h| u16::from_str_radix(h, 16).ok());
      if let (Some(Some(a)), Some(Some(b))) = (p.next(), p.next()) {
        id = Some((a, b));
      }
    } else if let Some(v) = line.strip_prefix("PCI_SLOT_NAME=") {
      slot = Some(v.trim().to_lowercase());
    }
  }
  (driver, id, slot)
}

/// The maker's and the model's names in the PCI ID list (pci.ids), if it has them.
pub fn pci_names(ids: &str, vendor: u16, device: u16) -> (Option<String>, Option<String>) {
  let v = format!("{vendor:04x}");
  let d = format!("{device:04x}");
  let mut vendor_name = None;
  for line in ids.lines() {
    if vendor_name.is_none() {
      // A maker: four hex digits at the start of the line, two spaces, the name.
      if line.len() > 6 && line[..4].eq_ignore_ascii_case(&v) && &line[4..6] == "  " {
        vendor_name = Some(line[6..].trim().to_string());
      }
      continue;
    }
    if !line.starts_with('\t') && !line.starts_with('#') && !line.is_empty() {
      break; // the next maker: the model is not listed
    }
    // A model: one tab, four hex digits, two spaces, the name (two tabs are sub-models).
    if let Some(rest) = line.strip_prefix('\t') {
      if !rest.starts_with('\t') && rest.len() > 6 && rest[..4].eq_ignore_ascii_case(&d) && &rest[4..6] == "  " {
        return (vendor_name, Some(rest[6..].trim().to_string()));
      }
    }
  }
  (vendor_name, None)
}

/// The short name of the big three graphics makers.
fn maker(vendor: u16) -> Option<&'static str> {
  match vendor {
    0x10de => Some("NVIDIA"),
    0x8086 => Some("Intel"),
    0x1002 => Some("AMD"),
    _ => None,
  }
}

/// A chip's name for people: Nvidia's own name for it if its driver gives one, else the maker and
/// the model's everyday name from pci.ids ("GA107M [GeForce RTX 3050 Mobile]" gives the part in
/// brackets), else the maker alone.
pub fn card_name(vendor: u16, device: u16, ids: Option<&str>, nvidia_model: Option<&str>) -> String {
  if let Some(m) = nvidia_model.map(str::trim).filter(|m| !m.is_empty()) {
    return m.to_string();
  }
  let (vendor_name, model) = ids.map(|t| pci_names(t, vendor, device)).unwrap_or((None, None));
  let who = maker(vendor).map(str::to_string).or(vendor_name).unwrap_or_else(|| format!("Graphics chip {vendor:04x}"));
  match model {
    Some(m) => {
      let everyday = match (m.find('['), m.rfind(']')) {
        (Some(a), Some(b)) if b > a + 1 => m[a + 1..b].to_string(),
        _ => m,
      };
      if everyday.to_lowercase().starts_with(&who.to_lowercase()) { everyday } else { format!("{who} {everyday}") }
    }
    None => format!("{who} graphics ({vendor:04x}:{device:04x})"),
  }
}

/// The model line of /proc/driver/nvidia/gpus/<pci>/information.
pub fn nvidia_info(text: &str) -> (Option<String>, Option<u32>) {
  let mut model = None;
  let mut minor = None;
  for line in text.lines() {
    if let Some((k, v)) = line.split_once(':') {
      match k.trim() {
        "Model" => model = Some(v.trim().to_string()),
        "Device Minor" => minor = v.trim().parse().ok(),
        _ => {}
      }
    }
  }
  (model, minor)
}

/// The PCI address a DRM device file's fdinfo names (Linux 5.19 and later).
pub fn fdinfo_pdev(text: &str) -> Option<String> {
  text.lines().find_map(|l| l.strip_prefix("drm-pdev:")).map(|v| v.trim().to_lowercase())
}

/// The parent process in /proc/<pid>/stat ("pid (name) state ppid …"; the name may hold spaces).
pub fn stat_parent(text: &str) -> Option<u32> {
  let after = &text[text.rfind(')')? + 1..];
  after.split_whitespace().nth(1)?.parse().ok()
}

/// A file a helper process has open: the process's name, where the file leads, its fdinfo.
pub struct OpenFile {
  pub process: String,
  pub target: String,
  pub fdinfo: String,
}

/// The PCI addresses of the chips WebKit draws with. WebGL runs in WebKit's GPU process when
/// there is one, so its files count first; then the web process's; then any helper's.
/// `nodes` gives the chip behind each /dev/dri file, `nvidia` the chip behind each /dev/nvidiaN.
pub fn chips_in_use(open: &[OpenFile], nodes: &HashMap<String, String>, nvidia: &HashMap<u32, String>) -> Vec<String> {
  let chip = |f: &OpenFile| -> Option<String> {
    if f.target.starts_with("/dev/dri/") {
      return fdinfo_pdev(&f.fdinfo).or_else(|| nodes.get(&f.target).cloned());
    }
    // Nvidia's own driver: /dev/nvidia0, 1 … are the chips (nvidiactl, -modeset, -uvm are not;
    // its libraries open those just to look around).
    let n: u32 = f.target.strip_prefix("/dev/nvidia")?.parse().ok()?;
    nvidia.get(&n).cloned()
  };
  let rank = |p: &str| if p.starts_with("WebKitGPU") { 0 } else if p.starts_with("WebKitWeb") { 1 } else { 2 };
  for r in 0..3 {
    let mut found: Vec<String> = open.iter().filter(|f| rank(&f.process) == r).filter_map(chip).collect();
    found.sort();
    found.dedup();
    if !found.is_empty() {
      return found;
    }
  }
  Vec::new()
}

/// The graphics chips and the one in use (Linux only: None elsewhere).
#[tauri::command]
pub fn linux_graphics() -> Option<Graphics> {
  #[cfg(target_os = "linux")]
  return Some(linux::read());
  #[cfg(not(target_os = "linux"))]
  None
}

#[cfg(target_os = "linux")]
mod linux {
  use super::*;
  use std::fs;
  use std::path::Path;

  const PCI_IDS: [&str; 3] = ["/usr/share/hwdata/pci.ids", "/usr/share/misc/pci.ids", "/usr/share/pci.ids"];

  pub fn read() -> Graphics {
    let ids = PCI_IDS.iter().find_map(|p| fs::read_to_string(p).ok());
    let mut cards: Vec<Card> = Vec::new();
    let mut nodes = HashMap::new();
    let mut nvidia = HashMap::new();
    let mut nvidia_models = HashMap::new();
    if let Ok(gpus) = fs::read_dir("/proc/driver/nvidia/gpus") {
      for g in gpus.flatten() {
        let pci = g.file_name().to_string_lossy().to_lowercase();
        let (model, minor) = nvidia_info(&fs::read_to_string(g.path().join("information")).unwrap_or_default());
        if let Some(m) = minor {
          nvidia.insert(m, pci.clone());
        }
        if let Some(m) = model {
          nvidia_models.insert(pci, m);
        }
      }
    }
    for e in fs::read_dir("/sys/class/drm").into_iter().flatten().flatten() {
      let node = e.file_name().to_string_lossy().into_owned();
      let is_card = node.strip_prefix("card").is_some_and(|n| n.parse::<u32>().is_ok());
      let is_render = node.strip_prefix("renderD").is_some_and(|n| n.parse::<u32>().is_ok());
      if !is_card && !is_render {
        continue; // connectors (card0-eDP-1) and the like
      }
      let dev = e.path().join("device");
      let (driver, id, slot) = parse_uevent(&fs::read_to_string(dev.join("uevent")).unwrap_or_default());
      let Some(slot) = slot else { continue };
      nodes.insert(format!("/dev/dri/{node}"), slot.clone());
      if !is_card || cards.iter().any(|c| c.pci == slot) {
        continue;
      }
      let (vendor, device) = id.unwrap_or((0, 0));
      cards.push(Card {
        name: card_name(vendor, device, ids.as_deref(), nvidia_models.get(&slot).map(String::as_str)),
        driver: driver.unwrap_or_default(),
        startup: fs::read_to_string(dev.join("boot_vga")).is_ok_and(|t| t.trim() == "1"),
        pci: slot,
        in_use: false,
      });
    }
    // The Nvidia driver can run with no DRM device of its own (nvidia-drm not loaded).
    for (pci, model) in &nvidia_models {
      if !cards.iter().any(|c| &c.pci == pci) {
        cards.push(Card { name: model.clone(), driver: "nvidia".into(), pci: pci.clone(), in_use: false, startup: false });
      }
    }

    let helpers = helper_processes();
    let open: Vec<OpenFile> = helpers.iter().flat_map(|&pid| open_files(pid)).collect();
    let used = chips_in_use(&open, &nodes, &nvidia);
    for c in &mut cards {
      c.in_use = used.contains(&c.pci);
    }
    cards.sort_by_key(|c| (!c.in_use, !c.startup));
    let checked = !helpers.is_empty();
    Graphics { software: checked && used.is_empty(), checked, cards }
  }

  /// Every process started (directly or not) by this one: WebKit's web, GPU and network processes.
  fn helper_processes() -> Vec<u32> {
    let me = std::process::id();
    let mut parent = HashMap::new();
    for e in fs::read_dir("/proc").into_iter().flatten().flatten() {
      let Ok(pid) = e.file_name().to_string_lossy().parse::<u32>() else { continue };
      if let Some(pp) = fs::read_to_string(e.path().join("stat")).ok().as_deref().and_then(stat_parent) {
        parent.insert(pid, pp);
      }
    }
    let mut mine = vec![me];
    let mut i = 0;
    while i < mine.len() {
      let p = mine[i];
      mine.extend(parent.iter().filter(|&(_, &pp)| pp == p).map(|(&c, _)| c));
      i += 1;
    }
    mine.retain(|&p| p != me);
    mine
  }

  /// The graphics device files a process has open.
  fn open_files(pid: u32) -> Vec<OpenFile> {
    let base = Path::new("/proc").join(pid.to_string());
    let process = fs::read_to_string(base.join("comm")).unwrap_or_default().trim().to_string();
    let mut out = Vec::new();
    for fd in fs::read_dir(base.join("fd")).into_iter().flatten().flatten() {
      let Ok(target) = fs::read_link(fd.path()) else { continue };
      let target = target.to_string_lossy().into_owned();
      if !target.starts_with("/dev/dri/") && !target.starts_with("/dev/nvidia") {
        continue;
      }
      let fdinfo = fs::read_to_string(base.join("fdinfo").join(fd.file_name())).unwrap_or_default();
      out.push(OpenFile { process: process.clone(), target, fdinfo });
    }
    out
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  const IDS: &str = "# pci.ids sample\n\
8086  Intel Corporation\n\
\t9a49  TigerLake-LP GT2 [Iris Xe Graphics]\n\
\t\t1028 0a1f  Iris Xe on a Dell\n\
\t46a6  Alder Lake-P GT2 [Iris Xe Graphics]\n\
10de  NVIDIA Corporation\n\
\t25a2  GA107M [GeForce RTX 3050 Mobile]\n\
\t1f99  TU117M\n\
1234  Some Maker\n";

  #[test]
  fn reads_a_uevent() {
    let (d, id, slot) = parse_uevent("DRIVER=i915\nPCI_CLASS=30000\nPCI_ID=8086:9A49\nPCI_SUBSYS_ID=1028:0A1F\nPCI_SLOT_NAME=0000:00:02.0\n");
    assert_eq!(d.as_deref(), Some("i915"));
    assert_eq!(id, Some((0x8086, 0x9a49)));
    assert_eq!(slot.as_deref(), Some("0000:00:02.0"));
  }

  #[test]
  fn names_chips() {
    assert_eq!(card_name(0x8086, 0x9a49, Some(IDS), None), "Intel Iris Xe Graphics");
    assert_eq!(card_name(0x10de, 0x25a2, Some(IDS), None), "NVIDIA GeForce RTX 3050 Mobile");
    assert_eq!(card_name(0x10de, 0x1f99, Some(IDS), None), "NVIDIA TU117M");
    // Nvidia's own driver knows best.
    assert_eq!(card_name(0x10de, 0x25a2, Some(IDS), Some("NVIDIA GeForce RTX 3050 Laptop GPU")), "NVIDIA GeForce RTX 3050 Laptop GPU");
    // Not in the list, or no list at all.
    assert_eq!(card_name(0x10de, 0x9999, Some(IDS), None), "NVIDIA graphics (10de:9999)");
    assert_eq!(card_name(0x1002, 0x1638, None, None), "AMD graphics (1002:1638)");
    assert_eq!(card_name(0x1234, 0x1111, Some(IDS), None), "Some Maker graphics (1234:1111)");
  }

  #[test]
  fn reads_nvidia_information() {
    let (m, n) = nvidia_info("Model: \t\t NVIDIA GeForce RTX 3050 Laptop GPU\nIRQ:   150\nGPU UUID: GPU-x\nDevice Minor: \t 0\nBus Type: PCIe\n");
    assert_eq!(m.as_deref(), Some("NVIDIA GeForce RTX 3050 Laptop GPU"));
    assert_eq!(n, Some(0));
  }

  #[test]
  fn reads_a_process_parent() {
    assert_eq!(stat_parent("4242 (WebKitWebProces) S 4100 4100 4100 0 -1"), Some(4100));
    assert_eq!(stat_parent("7 (odd ) name) R 1 7 7"), Some(1));
  }

  fn file(process: &str, target: &str, fdinfo: &str) -> OpenFile {
    OpenFile { process: process.into(), target: target.into(), fdinfo: fdinfo.into() }
  }

  #[test]
  fn finds_the_chip_in_use() {
    let nodes: HashMap<String, String> = [
      ("/dev/dri/renderD128".to_string(), "0000:00:02.0".to_string()),
      ("/dev/dri/renderD129".to_string(), "0000:01:00.0".to_string()),
    ]
    .into();
    let nvidia: HashMap<u32, String> = [(0, "0000:01:00.0".to_string())].into();
    // Intel through fdinfo; the web process's own file does not count when the GPU process has one.
    let open = [
      file("WebKitGPUProces", "/dev/dri/renderD128", "pos:\t0\ndrm-driver:\ti915\ndrm-pdev:\t0000:00:02.0\n"),
      file("WebKitWebProces", "/dev/dri/renderD129", ""),
    ];
    assert_eq!(chips_in_use(&open, &nodes, &nvidia), vec!["0000:00:02.0"]);
    // Without fdinfo (older Linux), from the device file.
    assert_eq!(chips_in_use(&[file("WebKitWebProces", "/dev/dri/renderD129", "pos: 0\n")], &nodes, &nvidia), vec!["0000:01:00.0"]);
    // Nvidia's own driver: /dev/nvidia0 is the chip; nvidiactl alone (a look around) is not.
    assert_eq!(chips_in_use(&[file("WebKitGPUProces", "/dev/nvidia0", "")], &nodes, &nvidia), vec!["0000:01:00.0"]);
    assert!(chips_in_use(&[file("WebKitGPUProces", "/dev/nvidiactl", ""), file("WebKitGPUProces", "/dev/nvidia-modeset", "")], &nodes, &nvidia).is_empty());
    // Nothing open: drawing in software.
    assert!(chips_in_use(&[], &nodes, &nvidia).is_empty());
  }
}
