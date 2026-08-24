## ADDED Requirements

### Requirement: Packaged-app qualification is a canonical evidence-producing lane
A canonical command SHALL build the production executable, launch the real built exe through the existing WebView2/CDP driver with per-run isolation, and assert: real Tauri IPC responds (history command), real collector data arrives and advances, the real settings store writes only inside the run-isolated directory, a representative UI interaction succeeds, teardown is clean, and no orphaned application or WebView processes remain. The lane SHALL reuse the existing simulation driver rather than introducing a second automation framework.

#### Scenario: Packaged lane proves the real binary end-to-end
- **WHEN** the packaged qualification command runs on a Windows machine with a fresh build
- **THEN** it exits nonzero on any failed assertion, zero when all pass, and records its result for CI evidence

#### Scenario: Shipped configuration gains no debugging surface
- **WHEN** the packaged lane runs
- **THEN** remote-debugging arguments are supplied per-process through environment variables owned by the verification process, and shipped Tauri configuration still contains no remote-debugging flag

### Requirement: Installer qualification executes the real install lifecycle
For each supported installer format (MSI, NSIS), CI SHALL run independent clean Windows jobs that: build the production installer; assert the artifact exists and is non-empty; install silently using the format's supported mechanism; locate the installed executable via system registration (no developer-path hardcoding); verify installed product/version identity against the release version; launch the installed executable under test isolation; confirm it survives startup and exercise a representative smoke flow where automation permits; uninstall silently; and assert removal of the installed executable/registration with no orphan processes. The two formats SHALL NOT share machine state.

#### Scenario: MSI qualifies end-to-end
- **WHEN** the MSI qualification job runs
- **THEN** silent install, version check, installed-exe smoke run, silent uninstall, and clean-removal assertions all pass or the job fails

#### Scenario: NSIS qualifies end-to-end
- **WHEN** the NSIS qualification job runs
- **THEN** the same lifecycle holds for the NSIS build, including user-data retention being asserted as documented product behavior rather than failure

#### Scenario: Qualification cost policy is explicit
- **WHEN** pull requests or ordinary pushes run
- **THEN** expensive packaged/installer qualification does not run as a required gate; it runs on manual dispatch and tag events by documented policy

### Requirement: Release artifacts carry integrity evidence
Successful installer builds SHALL produce an uploaded artifact manifest recording at minimum: application version, commit SHA, build timestamp, artifact filenames, sizes, SHA-256 hashes, installer type, signing status, and qualification result. Installers remain unsigned while no certificate exists, stated truthfully in workflow and docs, without weakening security gates.

#### Scenario: Manifest reflects reality
- **WHEN** the release-qualification workflow completes
- **THEN** the manifest lists every produced installer with correct size/hash/version and the recorded qualification outcome, and is uploaded alongside the installers
