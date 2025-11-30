---
name: spike-orchestrator
description: Spike test - A skill that orchestrates sub-agent calls using Python pseudocode. Use this to validate the skill-to-agent pattern.
---

# Spike Orchestrator

A skill that demonstrates orchestrating sub-agent calls via the Task tool.

## Purpose

Validate that:
1. A skill can invoke a custom plugin agent by name (`pairingbuddy:spike-echo`)
2. State passing via JSON files works
3. Python pseudocode can guide the workflow

## State File Mappings

```python
# Variable → File mappings:
# input_data    → .pairingbuddy/spike-input.json
# output_data   → .pairingbuddy/spike-output.json
```

## Workflow

Execute this workflow by following the Python pseudocode:

```python
# Step 1: Prepare input for the echo agent
input_data = {"message": "Hello from orchestrator skill", "source": "spike-orchestrator"}

# Step 2: Call the echo sub-agent
output_data = spike_echo(input_data)

# Step 3: Verify the output
assert output_data["processed_by"] == "spike-echo"
assert "[ECHOED]" in output_data["echo"]
```

## Instructions

To execute this workflow:

### Step 1: Prepare Input

Create the `.pairingbuddy/` directory if needed, then write the input JSON:

```json
{
  "message": "Hello from orchestrator skill",
  "source": "spike-orchestrator"
}
```

Write this to `.pairingbuddy/spike-input.json`

### Step 2: Invoke Sub-Agent

Use the **Task tool** to invoke the `pairingbuddy:spike-echo` agent:

```
Task tool:
  subagent_type: "pairingbuddy:spike-echo"
  description: "Echo the input data"
  prompt: "Process the input at .pairingbuddy/spike-input.json and write output to .pairingbuddy/spike-output.json"
```

### Step 3: Verify Output

After the sub-agent returns:
1. Read `.pairingbuddy/spike-output.json`
2. Verify `processed_by` equals "spike-echo"
3. Verify `echo` field contains "[ECHOED]"

### Step 4: Report Result

- If verification passes: "Spike orchestrator complete. Skill → Agent communication validated."
- If verification fails: Report what went wrong.

## Success Criteria

- [ ] Input file created correctly
- [ ] Sub-agent `pairingbuddy:spike-echo` was invoked successfully via Task tool
- [ ] Output file exists and contains expected fields
- [ ] Verification assertions pass
