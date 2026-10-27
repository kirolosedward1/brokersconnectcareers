# Cursor agent skills

Copies of upstream skills for agents working in this repository. Each folder keeps that project's `LICENSE`.

| Skill | Source | Commit |
| --- | --- | --- |
| [design-taste-frontend](design-taste-frontend/) | https://github.com/Leonxlnx/taste-skill | `12af471f627f866411b4bd785b19646d3672784c` |
| [impeccable](impeccable/) | https://github.com/pbakaus/impeccable (v4.8.0, tags `skill-v4.8.0` and `cli-v4.8.0`) | `414603bf14c7a344edb466bb1f85690c77ce8b7d` |
| [text-to-lottie](text-to-lottie/) | https://github.com/diffusionstudio/lottie | `3c72912fad543897f90045ed4d355813837927fc` |

`design-taste-frontend` is `skills/taste-skill` from that commit (install name `design-taste-frontend`): `SKILL.md`, `library/`, `scripts/`, plus `references/` and `assets/`, which those files point at. No library file is over 1 MB, so nothing was left out. `evals/` is not included.

`impeccable` is that repo's `.cursor/skills/impeccable` folder: `SKILL.md`, `reference/`, and `scripts/`. The hook installer was not run, and the engine binary is not committed. The launcher downloads it to `~/.impeccable` on first use.

`text-to-lottie` is `skills/text-to-lottie`: `SKILL.md` and `references/`. `evals/` is not included.
