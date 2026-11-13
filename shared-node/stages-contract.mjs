// Generated from contracts/stages.json by scripts/build-workflows.mjs. Do not edit: run that script to regenerate.
export default {
  "v": 1,
  "defaultTaskType": "config_change",
  "maxAgents": 1000,
  "stageMaxAgents": {
    "code-tdd": 600
  },
  "migratedTypes": [
    "config_change",
    "bug_fix",
    "new_feature"
  ],
  "newPathAgents": [
    "apply-config-change",
    "lens",
    "refuter",
    "runner"
  ],
  "gateClasses": {
    "continue": {
      "auto": "passes when evidence is complete and no stop condition applies"
    },
    "conditional": {
      "auto": "passes only when the classifier reports certain"
    },
    "decide": {
      "auto": "always asks the human"
    }
  },
  "taskTypes": {
    "config_change": {
      "nodes": [
        {
          "name": "code-config",
          "gate": null,
          "evidence": [
            "artifact:apply-config-change",
            "checkpoint:config"
          ]
        },
        {
          "name": "code-safety-net",
          "gate": "G:task-end",
          "evidence": [
            "artifact:update-documentation",
            "checkpoint:docs",
            "tests:full"
          ]
        }
      ],
      "gates": {
        "G:task-end": {
          "class": "continue"
        }
      }
    },
    "bug_fix": {
      "nodes": [
        {
          "name": "code-scenarios",
          "gate": "G:scenarios",
          "evidence": [
            "artifact:enumerate-scenarios-and-test-cases"
          ]
        },
        {
          "name": "code-tdd",
          "gate": null,
          "evidence": [
            "artifact:create-test-placeholders",
            "checkpoint:placeholders",
            "tests:cycle",
            "artifact:verify-test-coverage"
          ]
        },
        {
          "name": "code-safety-net",
          "gate": "G:task-end",
          "evidence": [
            "artifact:update-documentation",
            "checkpoint:docs",
            "tests:full"
          ]
        }
      ],
      "gates": {
        "G:scenarios": {
          "class": "continue"
        },
        "G:task-end": {
          "class": "continue"
        }
      }
    },
    "new_feature": {
      "nodes": [
        {
          "name": "code-scenarios",
          "gate": "G:scenarios",
          "evidence": [
            "artifact:enumerate-scenarios-and-test-cases"
          ]
        },
        {
          "name": "code-tdd",
          "gate": null,
          "evidence": [
            "artifact:create-test-placeholders",
            "checkpoint:placeholders",
            "tests:cycle",
            "artifact:verify-test-coverage"
          ]
        },
        {
          "name": "code-safety-net",
          "gate": "G:task-end",
          "evidence": [
            "artifact:update-documentation",
            "checkpoint:docs",
            "tests:full"
          ]
        }
      ],
      "gates": {
        "G:scenarios": {
          "class": "continue"
        },
        "G:task-end": {
          "class": "continue"
        }
      }
    },
    "publish": {
      "nodes": [
        {
          "name": "pr-draft",
          "gate": "G:publish",
          "evidence": [
            "artifact:draft-pull-request"
          ]
        }
      ],
      "gates": {
        "G:publish": {
          "class": "continue"
        }
      }
    }
  }
}
