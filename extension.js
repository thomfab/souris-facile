import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const MODIFIER_MASKS = {
    shift: Clutter.ModifierType.SHIFT_MASK,
    control: Clutter.ModifierType.CONTROL_MASK,
    alt: Clutter.ModifierType.MOD1_MASK,
    super: Clutter.ModifierType.MOD4_MASK,
};

const RELEVANT_MASK = Object.values(MODIFIER_MASKS).reduce((a, b) => a | b, 0);

const MIN_WIDTH = 100;
const MIN_HEIGHT = 60;

const GRID_LINE_WIDTH = 2;
const GRID_LINE_STYLE = 'background-color: rgba(255, 255, 255, 0.35);';
const DIM_STYLE = 'background-color: rgba(0, 0, 0, 0.5);';

const MANAGEABLE_TYPES = [
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
    Meta.WindowType.UTILITY,
];

const Op = {
    NONE: 0,
    MOVE: 1,
    RESIZE: 2,
};

function maskFromNames(names) {
    return names.reduce((mask, name) => mask | (MODIFIER_MASKS[name] ?? 0), 0);
}

function normalizeModifiers(mods) {
    // Super may be reported as SUPER_MASK, MOD4_MASK or both.
    if (mods & Clutter.ModifierType.SUPER_MASK)
        mods |= Clutter.ModifierType.MOD4_MASK;
    return mods & RELEVANT_MASK;
}

function isManageable(window) {
    return window.showing_on_its_workspace() &&
        MANAGEABLE_TYPES.includes(window.get_window_type());
}

// Evenly spaced positions from start to start + length, both included.
function divide(start, length, count) {
    return Array.from({length: count + 1}, (_, i) => Math.round(start + i * length / count));
}

// The shift that brings the closest of `edges` onto one of `lines`,
// or 0 if none is within `threshold`.
function snapDelta(edges, lines, threshold) {
    let best = 0;
    let bestDist = threshold;
    for (const edge of edges) {
        for (const line of lines) {
            const dist = Math.abs(line - edge);
            if (dist <= bestDist) {
                best = line - edge;
                bestDist = dist;
            }
        }
    }
    return best;
}

export default class SourisFacileExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._settingsChangedId = this._settings.connect('changed', () => this._loadSettings());
        this._loadSettings();

        this._op = Op.NONE;
        this._window = null;
        this._gridOverlay = null;
        this._dimmer = null;

        this._cursorTracker = global.backend.get_cursor_tracker();
        this._positionId = this._cursorTracker.connect('position-invalidated',
            () => this._onPointerMoved());
    }

    disable() {
        this._endOperation();

        this._cursorTracker.disconnect(this._positionId);
        this._cursorTracker = null;

        this._settings.disconnect(this._settingsChangedId);
        this._settings = null;
    }

    _loadSettings() {
        this._moveMask = maskFromNames(this._settings.get_strv('move-modifiers'));
        this._resizeMask = maskFromNames(this._settings.get_strv('resize-modifiers'));
        this._raiseWindow = this._settings.get_boolean('raise-window');
        this._resizeNearestCorner = this._settings.get_boolean('resize-nearest-corner');
        this._snapThreshold = this._settings.get_int('snap-threshold');
        this._snapToWindows = this._settings.get_boolean('snap-to-windows');
        this._gridEnabled = this._settings.get_boolean('grid-enabled');
        this._gridColumns = this._settings.get_int('grid-columns');
        this._gridRows = this._settings.get_int('grid-rows');
        this._showGrid = this._settings.get_boolean('show-grid');
        this._dimWindows = this._settings.get_boolean('dim-windows');
    }

    _opForModifiers(mods) {
        mods = normalizeModifiers(mods);
        if (this._resizeMask && mods === this._resizeMask)
            return Op.RESIZE;
        if (this._moveMask && mods === this._moveMask)
            return Op.MOVE;
        return Op.NONE;
    }

    _onPointerMoved() {
        const [x, y, mods] = global.get_pointer();
        let op = this._opForModifiers(mods);

        if (Main.overview.visible || Main.modalCount > 0)
            op = Op.NONE;

        if (op !== this._op) {
            this._endOperation();
            if (op !== Op.NONE)
                this._beginOperation(op, x, y);
            return;
        }

        if (this._op === Op.MOVE)
            this._updateMove(x, y);
        else if (this._op === Op.RESIZE)
            this._updateResize(x, y);
    }

    _beginOperation(op, x, y) {
        const window = this._findWindowAt(x, y);
        if (!window)
            return;
        if (op === Op.MOVE && !window.allows_move())
            return;
        if (op === Op.RESIZE && !window.allows_resize())
            return;

        const rect = window.get_frame_rect();

        this._op = op;
        this._window = window;
        this._unmanagedId = window.connect('unmanaged', () => this._endOperation());
        this._startX = x;
        this._startY = y;
        this._startRect = {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
        // Where the pointer sits inside the window, as a fraction of its size,
        // so a window that changes size (e.g. on unmaximize) stays under it.
        this._grabRatioX = (x - rect.x) / rect.width;
        this._grabRatioY = (y - rect.y) / rect.height;

        // Which edges a resize moves: -1 for left/top, 1 for right/bottom.
        if (this._resizeNearestCorner) {
            this._resizeDirX = this._grabRatioX < 0.5 ? -1 : 1;
            this._resizeDirY = this._grabRatioY < 0.5 ? -1 : 1;
        } else {
            this._resizeDirX = 1;
            this._resizeDirY = 1;
        }

        this._collectSnapTargets(window);

        if (this._raiseWindow)
            window.raise();

        if (this._gridEnabled && this._dimWindows)
            this._showDimmer(window);

        if (window.is_maximized()) {
            if (op === Op.RESIZE) {
                // Keep the maximized geometry as the starting point.
                const {x: rx, y: ry, width, height} = this._startRect;
                window.move_resize_frame(true, rx, ry, width, height);
            } else {
                window.unmaximize();
            }
        }
    }

    _endOperation() {
        if (this._window && this._unmanagedId)
            this._window.disconnect(this._unmanagedId);
        this._unmanagedId = 0;
        this._window = null;
        this._op = Op.NONE;
        this._workAreas = null;
        this._otherRects = null;
        this._hideGridOverlay();
        this._hideDimmer();
    }

    _updateMove(x, y) {
        const rect = this._window.get_frame_rect();
        let newX = Math.round(x - this._grabRatioX * rect.width);
        let newY = Math.round(y - this._grabRatioY * rect.height);

        newX += this._snapDelta([newX, newX + rect.width], this._snapLinesX(newY, rect.height));
        newY += this._snapDelta([newY, newY + rect.height], this._snapLinesY(newX, rect.width));

        this._window.move_frame(true, newX, newY);
    }

    _updateResize(x, y) {
        const {x: rx, y: ry, width, height} = this._startRect;
        const dx = x - this._startX;
        const dy = y - this._startY;

        let left = rx, right = rx + width;
        let top = ry, bottom = ry + height;

        if (this._resizeDirX > 0)
            right += dx;
        else
            left += dx;
        if (this._resizeDirY > 0)
            bottom += dy;
        else
            top += dy;

        const linesX = this._snapLinesX(top, bottom - top);
        if (this._resizeDirX > 0)
            right += this._snapDelta([right], linesX);
        else
            left += this._snapDelta([left], linesX);

        const linesY = this._snapLinesY(left, right - left);
        if (this._resizeDirY > 0)
            bottom += this._snapDelta([bottom], linesY);
        else
            top += this._snapDelta([top], linesY);

        if (right - left < MIN_WIDTH) {
            if (this._resizeDirX > 0)
                right = left + MIN_WIDTH;
            else
                left = right - MIN_WIDTH;
        }
        if (bottom - top < MIN_HEIGHT) {
            if (this._resizeDirY > 0)
                bottom = top + MIN_HEIGHT;
            else
                top = bottom - MIN_HEIGHT;
        }

        this._window.move_resize_frame(true, left, top, right - left, bottom - top);
    }

    _collectSnapTargets(window) {
        const workspace = global.workspace_manager.get_active_workspace();
        const nMonitors = global.display.get_n_monitors();

        this._workAreas = [];
        for (let i = 0; i < nMonitors; i++)
            this._workAreas.push(workspace.get_work_area_for_monitor(i));

        this._otherRects = workspace.list_windows()
            .filter(w => w !== window && isManageable(w))
            .map(w => w.get_frame_rect());
    }

    _snapDelta(edges, lines) {
        // The grid always snaps; edge snapping only within the threshold.
        const threshold = this._gridEnabled ? Infinity : this._snapThreshold;
        if (threshold <= 0)
            return 0;
        return snapDelta(edges, lines, threshold);
    }

    // Vertical lines a window spanning [top, top + height] can snap to.
    _snapLinesX(top, height) {
        if (this._gridEnabled) {
            const area = this._currentGridArea();
            return divide(area.x, area.width, this._gridColumns);
        }

        const lines = [];
        for (const area of this._workAreas)
            lines.push(area.x, area.x + area.width);

        if (this._snapToWindows) {
            const t = this._snapThreshold;
            for (const r of this._otherRects) {
                if (r.y - t < top + height && r.y + r.height + t > top)
                    lines.push(r.x, r.x + r.width);
            }
        }
        return lines;
    }

    // Horizontal lines a window spanning [left, left + width] can snap to.
    _snapLinesY(left, width) {
        if (this._gridEnabled) {
            const area = this._currentGridArea();
            return divide(area.y, area.height, this._gridRows);
        }

        const lines = [];
        for (const area of this._workAreas)
            lines.push(area.y, area.y + area.height);

        if (this._snapToWindows) {
            const t = this._snapThreshold;
            for (const r of this._otherRects) {
                if (r.x - t < left + width && r.x + r.width + t > left)
                    lines.push(r.y, r.y + r.height);
            }
        }
        return lines;
    }

    // The grid follows the monitor under the pointer.
    _currentGridArea() {
        const monitor = global.display.get_current_monitor();
        const area = this._workAreas[monitor] ?? this._workAreas[0];
        if (this._showGrid)
            this._showGridOverlay(monitor, area);
        return area;
    }

    _showGridOverlay(monitor, area) {
        if (this._gridOverlay && this._gridOverlayMonitor === monitor)
            return;
        this._hideGridOverlay();

        const overlay = new St.Widget({
            x: area.x,
            y: area.y,
            width: area.width,
            height: area.height,
            reactive: false,
        });

        const half = GRID_LINE_WIDTH / 2;
        const xs = divide(0, area.width, this._gridColumns).slice(1, -1);
        const ys = divide(0, area.height, this._gridRows).slice(1, -1);
        for (const x of xs) {
            overlay.add_child(new St.Widget({
                x: x - half, y: 0, width: GRID_LINE_WIDTH, height: area.height,
                style: GRID_LINE_STYLE,
            }));
        }
        for (const y of ys) {
            overlay.add_child(new St.Widget({
                x: 0, y: y - half, width: area.width, height: GRID_LINE_WIDTH,
                style: GRID_LINE_STYLE,
            }));
        }

        Main.layoutManager.uiGroup.add_child(overlay);
        this._gridOverlay = overlay;
        this._gridOverlayMonitor = monitor;
    }

    _hideGridOverlay() {
        this._gridOverlay?.destroy();
        this._gridOverlay = null;
        this._gridOverlayMonitor = -1;
    }

    // Darken everything but the window being moved or resized: a dark layer
    // over all windows, with a live copy of that window on top of it, so it
    // stays bright even when other windows are stacked above it.
    _showDimmer(window) {
        const actor = window.get_compositor_private();
        if (!actor)
            return;

        const dimmer = new St.Widget({
            x: 0,
            y: 0,
            width: global.stage.width,
            height: global.stage.height,
            style: DIM_STYLE,
            reactive: false,
        });
        const clone = new Clutter.Clone({source: actor, reactive: false});
        clone.add_constraint(new Clutter.BindConstraint({
            source: actor,
            coordinate: Clutter.BindCoordinate.POSITION,
        }));
        dimmer.add_child(clone);

        global.window_group.add_child(dimmer);
        this._dimmer = dimmer;
    }

    _hideDimmer() {
        this._dimmer?.destroy();
        this._dimmer = null;
    }

    _findWindowAt(x, y) {
        const workspace = global.workspace_manager.get_active_workspace();
        const windows = global.display.sort_windows_by_stacking(workspace.list_windows());

        // Topmost first.
        for (let i = windows.length - 1; i >= 0; i--) {
            const window = windows[i];
            if (!isManageable(window))
                continue;

            const rect = window.get_frame_rect();
            if (x < rect.x || x >= rect.x + rect.width ||
                y < rect.y || y >= rect.y + rect.height)
                continue;

            // A fullscreen window on top hides everything below it.
            return window.is_fullscreen() ? null : window;
        }
        return null;
    }
}
