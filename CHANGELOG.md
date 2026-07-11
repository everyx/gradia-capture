# Changelog

All notable changes to Gradia Capture are documented here.

## [v1.1.0] - 2026-07-11

### Bug Fixes

- Fix missing "the" in prefs label
- Text tool input and display position offset
- Suppress benign stage warnings in text entry and toolbar
- Hide annotations during OCR + OCR button always triggers
- Add null guards, disposed object safety, and signal cleanup
- Disable undo/clear when annotation canvas is hidden
- Update undo/clear button state on tool switch from OCR
- Move OCR button to end of toolbar
- Use pulsing scanner icon for OCR loading to match toolbar style
- Position toolbar in stage coordinates for multi-monitor support
- Store previewScale on stroke for HiDPI brush surface rendering
- Anchor mosaic block grid to first click point for deterministic alignment
- Route handle visibility through SelectionClearer, keep selection box visible
- Convert preview origin to canvas-local in BlurSelector.renderPreviewSurface
- Resize entry border when line width changes without text
- Save screenshot to temp dir instead of ~/Pictures/Screenshots
- Use GNOME Shell's localized screenshot directory name
- Restore device-pixel drag surface to eliminate fractional jitter
- Pass PAD constant to _showCopyBtn to fix ReferenceError

### Ci

- Automated release workflow with changelog generation

### Chores

- Add dev.sh script and ignore logs dir
- Add AGENTS.md for OpenCode sessions
- Remove unused forEachCanvasReverse method
- Scaffold agent skills configuration
- Add oxlint + oxfmt, move scripts to scripts/

### Documentation

- Document differences from upstream fork

### Features

- Dynamic toolbar positioning with right-alignment
- Collapse inline color swatches into a dropdown ColorMenu
- Scroll to resize last drawn stroke in real-time
- Multi-line text input with auto-height
- Switch OCR backend from Gradia Flatpak to RapidOCR
- OCR text selection with block-range and rectangle modes
- Pixelation engine, preview, cursor, and submenu
- Real-time block size preview and Ctrl+scroll adjustment
- Add gettext i18n support, restructure src/data/dist layout
- Font picker for text annotation tool (#10)

### Other

- Initial
- Add touch support
- Hide on recording mode
- Multi monitor improvements
- Move top bar to own file
- Add filled square and number tools
- Add thickness slider
- Add undo keybind
- Add per tool persistance
- Draw under selection
- Add text tool
- Fix text on multi monitor
- Modify screenshot before save
- Small fixes
- Initial
- Merge pull request #1 from AlexanderVanhee/selection

Initial
- Refactor
- Update metadata.json
- Trash button improvements
- Change name
- Create LICENSE
- Update README.md
- Update README.md
- Update README.md
- Update README.md
- Merge branch 'master' of https://github.com/AlexanderVanhee/gradia-capture
- Update README
- Add resolution overlay
- Merge pull request #2 from AlexanderVanhee/resolution-overlay

Add resolution overlay
- Overwrite Ctrl+C to only copy the screenshot
- Only override ctrl+c for screenshot mode
- Make saving async
- Add OCR support via Gradia
- Disable selection tool in screen mode
- Merge pull request #5 from AlexanderVanhee/selection-tool-disable

Disable selection tool in screen mode
- Minor fixes
- Fix stamps to work like in Gradia
- Merge pull request #8 from AlexanderVanhee/stamp-counter-fix

Fix stamps to work like in Gradia
- Add preferences menu
- Add annotation preferences
- Merge pull request #9 from AlexanderVanhee/preferences-menu

Add preferences menu
- Minor fixes
- Add text extraction shortcut
- Update color button styles
- Initial
- Update
- Merge pull request #11 from AlexanderVanhee/toast

Add new toast for screenshots
- Update ID
- Toast tweaks
- Add selection color/width editing
- Formatting
- Add Gradia install guide row
- Cleanup fixes
- Update README
- Update README
- Add line width scroll
- Add "Save as..." option
- Merge pull request #14 from AlexanderVanhee/save-as

Add "Save as..." option
- Merge pull request #13 from kolunmi/master

fix missing "the" in prefs label
- Make always copy as PNG for better support
- Add a toggle to disable initial selection
- Merge pull request #15 from AlexanderVanhee/disable-initial-selection

Add a toggle to disable initial selection
- Fix toast button for touch
- Merge branch 'master' of https://github.com/AlexanderVanhee/gradia-capture
- Fix flickering when switching between modes
- Add include parent option
- Merge pull request #16 from AlexanderVanhee/window-composite

Add include parent option
- Fix layering issue
- Update button styling
- Modify toast

### Performance

- Early-return in hasStrokes getter
- Replace forEachCanvasReverse with for loop in undo()
- Deduplicate concurrent cache fills and pre-populate at init
- Eliminate intermediate array in brush preview and merge pixelation passes

### Refactoring

- Extract OCR pipeline into OcrSelector deep module
- Extract DrawingCanvas into standalone canvas module
- Extract monitor management into MonitorManager module
- Decouple annotation pipeline into AnnotationManager module
- Use annotationManager.deleteSelected in trash button
- Tools self-manage deactivation via button notify::checked
- Extract _disconnectToolDeactivate helper
- Extract text-entry lifecycle into TextEntryManager
- Extract signal wiring from _ensureUI into _wireSignals() (#34)
- Extract screenshot capture pipeline into ScreenshotCapture module (#35)
- Extract drag tool logic into DragTool module (#36)
- Extract keyboard/shortcut dispatch into ShortcutDispatcher module
- Rename files for clearer naming
- Extract _computeBlurRegionBounds to DRY selection/brush bounds logic
- Replace previewBlocks with Cairo surface for selection blur
- Unify pixelation pipeline with absolute coordinates
- Replace overlay widget with canvas-embedded drag surface
- Remove dead ocr-clear signal wiring
- Extract BlurSelector deep module from extension.js
- Unify tool-state seam — eliminate all reach-ins
- Merge AnnotationManager + MonitorManager into CanvasCollection
- Extract CaptureContext to centralize mode/origin/scale reads
- Extract tool classes, unify prop schema with child GSettings
- DDD directory layout, toolbar data-driven, dispatcher intent-table, blur origin fix
- Complete architecture deepening across codebase
- Extract SelectionCornerButton shared widget, fix btn overflow
- Replace custom PopupMenu with native BoxPointer
- Extract shared selection/monitor geometry helpers to src/ui/geometry.js


