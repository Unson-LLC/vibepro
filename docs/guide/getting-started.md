# Install and First Run

VibePro requires Node.js 20 or newer. The public package is currently a beta.

```bash
npx vibepro@beta --help
# or
npm install -g vibepro@beta
vibepro --help
```

Initialize a target repository:

```bash
vibepro init /path/to/repo \
  --story-id story-example \
  --title "Example change" \
  --language en
```

This creates `.vibepro/` in the target repository. It is a context and evidence workspace, not application source.

Check the installation and repository state:

```bash
vibepro doctor /path/to/repo --json
vibepro status /path/to/repo --json
vibepro story list /path/to/repo --all
```

Then follow the [Minimal Core Flow](/guide/control-loop). Use `vibepro help --language en` whenever documentation and the installed package differ.
