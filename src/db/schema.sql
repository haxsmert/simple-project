CREATE TABLE IF NOT EXISTS actors (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('human','agent')),
  handle     TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  parent_id     TEXT REFERENCES tasks(id),
  state         TEXT NOT NULL CHECK (state IN
                  ('planning','awaiting_confirm','executing','awaiting_decision','testing','done')),
  current_actor TEXT REFERENCES actors(id),
  current_role  TEXT CHECK (current_role IN ('planner','executor','tester','questioner','decider')),
  goal          TEXT,
  inputs_md     TEXT,
  outputs_md    TEXT,
  summary       TEXT,
  priority      TEXT CHECK (priority IN ('hi','mid','lo')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (
  id         TEXT PRIMARY KEY,
  from_task  TEXT NOT NULL REFERENCES tasks(id),
  to_task    TEXT NOT NULL REFERENCES tasks(id),
  type       TEXT NOT NULL CHECK (type IN ('blocks','depends_on','clarifies','spawns')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id),
  actor_id   TEXT NOT NULL REFERENCES actors(id),
  kind       TEXT NOT NULL CHECK (kind IN ('handoff','comment','output','clarify','decide','claim')),
  role_from  TEXT,
  role_to    TEXT,
  body       TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_state  ON tasks(state);
CREATE INDEX IF NOT EXISTS idx_edges_from   ON edges(from_task);
CREATE INDEX IF NOT EXISTS idx_edges_to     ON edges(to_task);
CREATE INDEX IF NOT EXISTS idx_events_task  ON events(task_id);
