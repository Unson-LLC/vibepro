# Install and First Run

VibePro requires Node.js 20 or newer. The public package is currently a beta.

The following guide uses a global installation:

```bash
npm install -g vibepro@beta
vibepro --help
```

To inspect the CLI without a global installation, use `npx vibepro@beta --help`. In the remaining examples, replace `vibepro` with `npx vibepro@beta` if you choose that route.

Choose one change in a Git repository. Replace `/path/to/repo`, the Story ID, and the title with your own values. Initialize the workspace:

```bash
vibepro init /path/to/repo \
  --story-id story-example \
  --title "Example change" \
  --language en
```

This creates `.vibepro/` in the target repository. It stores structured Story, Spec, and evidence records, not application source. Initialization alone does not describe the required behavior or verify your change.

Check the installation and repository state:

```bash
vibepro doctor /path/to/repo --json
vibepro status /path/to/repo --json
vibepro story list /path/to/repo --all
```

Next, write the expected behavior and follow [One Change Through PR Preparation](/guide/control-loop). Use `vibepro help --language en` whenever documentation and the installed package differ.
