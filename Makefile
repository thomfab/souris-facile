UUID := souris-facile@thomfab
INSTALL_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: schemas link unlink pack nested logs

schemas:
	glib-compile-schemas schemas/

# Symlink the working tree into the extensions dir for development.
link: schemas
	ln -sfn $(CURDIR) $(INSTALL_DIR)

unlink:
	rm -f $(INSTALL_DIR)

pack:
	gnome-extensions pack --force .

# Run a nested GNOME Shell for testing (needs mutter-devkit).
nested: schemas
	dbus-run-session gnome-shell --devkit --wayland

logs:
	journalctl -f -o cat /usr/bin/gnome-shell
