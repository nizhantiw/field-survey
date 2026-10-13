# Device test matrix

Advertised install targets, once a production HTTPS deployment exists:

| Device | Browser | Install |
| --- | --- | --- |
| Android phone | Chrome | Browser menu, Install app or Add to Home screen |
| iPhone | Safari | Share, Add to Home Screen |

Desktop Chromium in Playwright was used for automated checks. That does not certify either phone.

| Check | Android Chrome | iPhone Safari / Home Screen | Automated stand-in |
| --- | --- | --- | --- |
| P9-01 full expedition, airplane mode, one server record | BLOCKED. No device. | BLOCKED. No device. | Partial. Harness offline collection and synthetic map render passed in Chromium. No real server confirmation. |
| P9-02 restart keeps unsynced records and photos | BLOCKED | BLOCKED | P3-01 relaunched the same Chromium profile and read the draft back. Not a phone reboot. |
| P9-03 camera and location denial, then recovery | BLOCKED | BLOCKED | P5-01 denied geolocation in Chromium and did not invent coordinates. Camera permission was not exercised. |
| P9-04 layout at 320, 360, 390, 430, and 768 px | BLOCKED for a physical viewport and virtual keyboard | BLOCKED | Playwright resized a desktop Chromium window. Overflow was at most 1 px. Virtual keyboard was not opened. |
| P9-05 keyboard, labels, focus, contrast, status | BLOCKED for a device screen reader | BLOCKED | axe-core on the sign-in page reported no serious or critical violations. A person using a screen reader was not part of the run. |
| P9-06 deployed update keeps unsynced work | BLOCKED | BLOCKED | `mayApplyAppUpdate` unit check passed. No second deployed build was installed over local work. |

Help text in the app describes the Android Chrome and iPhone Safari install steps. Those sentences are instructions, not test results.
