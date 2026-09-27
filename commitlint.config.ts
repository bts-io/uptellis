// Conventional Commits (https://www.conventionalcommits.org). CI lints every PR title and every commit in a
// PR or push with this config. Body and footer line lengths are not limited, so generated commits (Dependabot,
// release PRs) with long links still pass.
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
};
