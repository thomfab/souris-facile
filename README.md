# Souris Facile

A GNOME Shell extension to move or resize the window under the pointer by
holding modifier keys and moving the mouse — no clicking, no dragging, no
aiming for a title bar or a window border.

## Why

I've always struggled with window management, be it on Windows, MacOS or Linux. Windows always overlap, grabbing the titlebar is harder and harder (with controls embedded in the title bar now), and resizing is always challenging (2x2 pixels area in bottom right anyone ?). I thought tiling window managers would help and tried several, but the forced tiles are not for me. Then I tried [Moom](https://manytricks.com/moom/) on the Mac, and bought the one feature I really use: the Hover feature (for me, ctrl+option and then move the mouse to move the window under the cursor, and ctrl+option+cmd to resize). This Gnome extension reproduces this feature. If you find it useful, use it.

(Disclaimer: Claude Code helped me)

## How it works

Hold a key combination and move the mouse:

| Keys (default)           | Action                                     |
| ------------------------ | ------------------------------------------ |
| `Ctrl` + `Alt`           | Move the window under the pointer          |
| `Ctrl` + `Alt` + `Super` | Resize the window under the pointer        |

Release the keys to stop. The combination must match exactly, and both can
be changed (or disabled) in the preferences.

- **Moving** keeps the window at the same spot under the pointer. A maximized
  window is unmaximized as soon as you start moving it.
- **Resizing** pulls the corner nearest the pointer, so you can grow or shrink
  a window from any side. It can also be set to always use the bottom-right
  corner.
- Nothing happens while the Activities overview or a modal dialog is open, or
  over a fullscreen window.

### Snapping

By default, window edges snap to screen edges and to the edges of neighbouring
windows when they come within 16 pixels. The distance is configurable, and `0`
turns snapping off.

### Grid

Turn on the grid to divide each monitor into columns and rows: moved and
resized edges then always land on a grid line, which makes tiling windows
quick and precise. The grid follows the monitor under the pointer and its
lines can be shown while you move or resize, with the other windows dimmed
so the grid and the window you are placing stand out.

Some presets are included (from 2 × 2 for a small laptop to 8 × 3 for a 42″
ultrawide), and you can save your own sizes under a name.

## Preferences

Open them with:

```sh
gnome-extensions prefs souris-facile@thomfab
```

| Setting                    | Default              |
| -------------------------- | -------------------- |
| Move keys                  | `Ctrl` + `Alt`       |
| Resize keys                | `Ctrl` + `Alt` + `Super` |
| Raise window               | Off                  |
| Resize from nearest corner | On                   |
| Snap distance              | 16 px                |
| Snap to other windows      | On                   |
| Snap to grid               | Off (4 × 3)          |
| Show grid                  | On                   |
| Dim other windows          | On                   |

## Installation

Requires GNOME Shell 51.

```sh
git clone https://github.com/thomfab/souris-facile.git
cd souris-facile
make link
```

`make link` compiles the settings schema and symlinks the folder into
`~/.local/share/gnome-shell/extensions/`. Log out and back in (on Wayland),
then enable it:

```sh
gnome-extensions enable souris-facile@thomfab
```

To uninstall, disable it and run `make unlink`.

## Development

| Command       | Description                                            |
| ------------- | ------------------------------------------------------ |
| `make link`   | Compile the schema and symlink the extension           |
| `make unlink` | Remove the symlink                                     |
| `make pack`   | Build a `.shell-extension.zip`                         |
| `make nested` | Run a nested GNOME Shell for testing (needs mutter-devkit) |
| `make logs`   | Follow GNOME Shell's logs                              |

## License

Souris Facile is licensed under the GNU General Public License, version 2 or
(at your option) any later version. See [LICENSE](LICENSE).
