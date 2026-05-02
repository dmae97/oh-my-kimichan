# /speckit-tasks

Generate an OMK-optimized task list.

Output: `specs/[###-feature]/tasks.md`

Each task includes OMK Execution Metadata:
- `role` — agent role that executes the task
- `deps` — topological dependencies for DAG scheduling
- `files` — expected output files for evidence gates
- `verify` — post-task verification command
- `gate` — evidence gate type (file-exists, command-pass, etc.)
- `risk` — checkpoint trigger (high = auto-checkpoint before execution)

This metadata dramatically improves tasks.md → DAG conversion accuracy.
