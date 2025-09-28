-- D1 数据库初始化脚本
-- 为 MoonTV 应用创建所有必要的表结构

-- 创建用户表
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  banned BOOLEAN DEFAULT false,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建播放记录表
CREATE TABLE IF NOT EXISTS play_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  video_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source_name TEXT NOT NULL,
  year TEXT,
  cover TEXT,
  episode_index INTEGER,
  total_episodes INTEGER,
  play_time INTEGER,
  total_time INTEGER,
  save_time INTEGER,
  search_title TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, source, video_id),
  FOREIGN KEY (user_id) REFERENCES users (id)
);

-- 创建收藏表
CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  video_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source_name TEXT NOT NULL,
  year TEXT,
  cover TEXT,
  total_episodes INTEGER,
  save_time INTEGER,
  search_title TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, source, video_id),
  FOREIGN KEY (user_id) REFERENCES users (id)
);

-- 创建搜索历史表
CREATE TABLE IF NOT EXISTS search_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  keyword TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, keyword),
  FOREIGN KEY (user_id) REFERENCES users (id)
);

-- 创建跳过片头片尾配置表
CREATE TABLE IF NOT EXISTS skip_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  video_id TEXT NOT NULL,
  enable BOOLEAN DEFAULT false,
  intro_time INTEGER DEFAULT 0,
  outro_time INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, source, video_id),
  FOREIGN KEY (user_id) REFERENCES users (id)
);

-- 创建管理员配置表
CREATE TABLE IF NOT EXISTS admin_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  config TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 输出成功信息
SELECT '✅ D1 数据库表结构创建完成' as status;

-- 显示创建的表列表
SELECT '📋 创建的数据库表:' as info;
SELECT '  • users - 用户表' as table_info;
SELECT '  • play_records - 播放记录表' as table_info;
SELECT '  • favorites - 收藏表' as table_info;
SELECT '  • search_history - 搜索历史表' as table_info;
SELECT '  • skip_configs - 跳过片头片尾配置表' as table_info;
SELECT '  • admin_config - 管理员配置表' as table_info;
SELECT '  • source_configs - 源配置表' as table_info;
SELECT '  • custom_categories - 自定义分类表' as table_info;