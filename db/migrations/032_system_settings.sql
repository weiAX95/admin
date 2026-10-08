CREATE TABLE system_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  system_name text NOT NULL DEFAULT 'Agent 学习管理端',
  logo_url text,
  default_timezone text NOT NULL DEFAULT 'Asia/Shanghai',
  default_language text NOT NULL DEFAULT 'zh-CN',
  default_date_format text NOT NULL DEFAULT 'YYYY-MM-DD',
  default_page_size integer NOT NULL DEFAULT 20,
  session_hours integer NOT NULL DEFAULT 24,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (default_language IN ('zh-CN', 'en-US')),
  CHECK (default_date_format IN ('YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY')),
  CHECK (default_page_size IN (10, 20, 50, 100)),
  CHECK (session_hours BETWEEN 1 AND 720)
);
INSERT INTO system_settings(id) VALUES (1);

CREATE TABLE user_preferences (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  timezone text,
  language text CHECK (language IN ('zh-CN', 'en-US')),
  date_format text CHECK (date_format IN ('YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY')),
  theme text NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light')),
  primary_color text NOT NULL DEFAULT '#9582ff',
  density text NOT NULL DEFAULT 'comfortable' CHECK (density IN ('comfortable', 'compact')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
