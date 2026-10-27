import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const MODIFIERS = [
    ['shift', 'Shift'],
    ['control', 'Ctrl'],
    ['alt', 'Alt'],
    ['super', 'Super'],
];

const GRID_PRESETS = [
    {name: 'Laptop 13–14″', columns: 2, rows: 2},
    {name: 'Laptop 15–16″', columns: 3, rows: 2},
    {name: '24″ 16:10', columns: 4, rows: 3},
    {name: '42″ ultrawide', columns: 6, rows: 2},
    {name: '42″ ultrawide, fine', columns: 8, rows: 3},
];

function gridLabel({name, columns, rows}) {
    return `${name} — ${columns} × ${rows}`;
}

function getSavedGrids(settings) {
    return settings.get_value('saved-grids').deepUnpack()
        .map(([name, columns, rows]) => ({name, columns, rows}));
}

function setSavedGrids(settings, grids) {
    settings.set_value('saved-grids', new GLib.Variant('a(sii)',
        grids.map(g => [g.name, g.columns, g.rows])));
}

function applyGrid(settings, {columns, rows}) {
    settings.set_int('grid-columns', columns);
    settings.set_int('grid-rows', rows);
}

function buildGridGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Grid',
        description: 'Divide each monitor into a grid. Moved and resized edges always snap to its lines.',
    });
    const gridRow = new Adw.SwitchRow({title: 'Snap to grid'});
    settings.bind('grid-enabled', gridRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(gridRow);

    // Built-in presets, then saved grids, then a "Custom" entry shown when
    // the current size matches none of them.
    const sizeRow = new Adw.ComboRow({
        title: 'Grid size',
        subtitle: 'A preset or one of your saved grids',
    });
    let choices = [];
    let syncing = false;

    const syncSelected = () => {
        const columns = settings.get_int('grid-columns');
        const rows = settings.get_int('grid-rows');
        const index = choices.findIndex(g => g.columns === columns && g.rows === rows);
        syncing = true;
        sizeRow.selected = index >= 0 ? index : choices.length;
        syncing = false;
    };
    const syncChoices = () => {
        choices = [...GRID_PRESETS, ...getSavedGrids(settings)];
        syncing = true;
        sizeRow.model = Gtk.StringList.new([...choices.map(gridLabel), 'Custom']);
        syncing = false;
        syncSelected();
    };
    syncChoices();
    settings.connect('changed::saved-grids', syncChoices);
    settings.connect('changed::grid-columns', syncSelected);
    settings.connect('changed::grid-rows', syncSelected);

    sizeRow.connect('notify::selected', () => {
        const grid = choices[sizeRow.selected];
        if (!syncing && grid)
            applyGrid(settings, grid);
    });
    group.add(sizeRow);

    const columnsRow = Adw.SpinRow.new_with_range(1, 48, 1);
    columnsRow.title = 'Columns';
    settings.bind('grid-columns', columnsRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    group.add(columnsRow);

    const rowsRow = Adw.SpinRow.new_with_range(1, 48, 1);
    rowsRow.title = 'Rows';
    settings.bind('grid-rows', rowsRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    group.add(rowsRow);

    const showRow = new Adw.SwitchRow({
        title: 'Show grid',
        subtitle: 'Draw the grid lines while moving or resizing',
    });
    settings.bind('show-grid', showRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(showRow);

    for (const row of [sizeRow, columnsRow, rowsRow, showRow])
        settings.bind('grid-enabled', row, 'sensitive', Gio.SettingsBindFlags.GET);

    return group;
}

function buildSavedGridsGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Saved Grids',
        description: 'Save the current columns and rows under a name to pick it again later.',
    });

    const saveRow = new Adw.EntryRow({
        title: 'Save current size as…',
        show_apply_button: true,
    });
    saveRow.connect('apply', () => {
        const name = saveRow.text.trim();
        if (!name)
            return;
        // Saving under an existing name replaces that grid.
        const grids = getSavedGrids(settings).filter(g => g.name !== name);
        grids.push({
            name,
            columns: settings.get_int('grid-columns'),
            rows: settings.get_int('grid-rows'),
        });
        setSavedGrids(settings, grids);
        saveRow.text = '';
    });
    group.add(saveRow);

    let gridRows = [];
    const sync = () => {
        for (const row of gridRows)
            group.remove(row);

        gridRows = getSavedGrids(settings).map(grid => {
            const row = new Adw.ActionRow({
                title: grid.name,
                subtitle: `${grid.columns} × ${grid.rows}`,
                use_markup: false,
                activatable: true,
            });
            row.connect('activated', () => applyGrid(settings, grid));

            const deleteButton = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                tooltip_text: 'Delete',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
            });
            deleteButton.connect('clicked', () => {
                setSavedGrids(settings,
                    getSavedGrids(settings).filter(g => g.name !== grid.name));
            });
            row.add_suffix(deleteButton);

            group.add(row);
            return row;
        });
    };
    sync();
    settings.connect('changed::saved-grids', sync);

    settings.bind('grid-enabled', group, 'sensitive', Gio.SettingsBindFlags.GET);
    return group;
}

function buildModifierGroup(settings, key, title, description) {
    const group = new Adw.PreferencesGroup({title, description});

    for (const [name, label] of MODIFIERS) {
        const row = new Adw.SwitchRow({title: label});
        const sync = () => {
            row.active = settings.get_strv(key).includes(name);
        };
        sync();
        settings.connect(`changed::${key}`, sync);

        row.connect('notify::active', () => {
            const current = settings.get_strv(key);
            if (row.active === current.includes(name))
                return;
            const updated = row.active
                ? [...current, name]
                : current.filter(n => n !== name);
            settings.set_strv(key, MODIFIERS.map(([n]) => n).filter(n => updated.includes(n)));
        });

        group.add(row);
    }

    return group;
}

export default class SourisFacilePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();

        page.add(buildModifierGroup(settings, 'move-modifiers', 'Move',
            'Hold these keys and move the mouse to move the window under the pointer. Turn all off to disable.'));
        page.add(buildModifierGroup(settings, 'resize-modifiers', 'Resize',
            'Hold these keys and move the mouse to resize the window under the pointer. Turn all off to disable.'));

        const behavior = new Adw.PreferencesGroup({title: 'Behavior'});
        const raiseRow = new Adw.SwitchRow({
            title: 'Raise window',
            subtitle: 'Bring the window to the front when it starts moving or resizing',
        });
        settings.bind('raise-window', raiseRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        behavior.add(raiseRow);

        const cornerRow = new Adw.SwitchRow({
            title: 'Resize from nearest corner',
            subtitle: 'Resize from the corner closest to the pointer instead of always the bottom-right one',
        });
        settings.bind('resize-nearest-corner', cornerRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        behavior.add(cornerRow);
        page.add(behavior);

        const snapping = new Adw.PreferencesGroup({
            title: 'Edge Snapping',
            description: 'Window edges snap to screen edges when they come close. Not used while the grid is on.',
        });
        const thresholdRow = Adw.SpinRow.new_with_range(0, 200, 1);
        thresholdRow.title = 'Snap distance';
        thresholdRow.subtitle = 'In pixels. 0 turns edge snapping off';
        settings.bind('snap-threshold', thresholdRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        snapping.add(thresholdRow);

        const windowsRow = new Adw.SwitchRow({
            title: 'Snap to other windows',
            subtitle: 'Also snap to the edges of neighbouring windows',
        });
        settings.bind('snap-to-windows', windowsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        snapping.add(windowsRow);
        page.add(snapping);

        settings.bind('grid-enabled', thresholdRow, 'sensitive',
            Gio.SettingsBindFlags.GET | Gio.SettingsBindFlags.INVERT_BOOLEAN);
        settings.bind('grid-enabled', windowsRow, 'sensitive',
            Gio.SettingsBindFlags.GET | Gio.SettingsBindFlags.INVERT_BOOLEAN);

        page.add(buildGridGroup(settings));
        page.add(buildSavedGridsGroup(settings));

        window.add(page);
    }
}
