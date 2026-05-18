# P0-P3 集成测试矩阵

## 测试目标

验证 P0-P3 改动在真实 DeepSeek 调用中是否生效，采集 telemetry 数据，决定是否进入 P4。

## 环境准备

```bash
# 使用本地二开版本
cd /Users/apple/go-project/ai/opencode/packages/opencode
export PATH="$HOME/.bun/bin:$PATH"

# 运行本地版本（不用全局安装版本）
alias oc="bun run --conditions=browser ./src/index.ts"

# 确认版本
oc --version  # 应输出 "local"

# 确认 DeepSeek 模型可用
oc models deepseek
```

## 通过标准

### 必须通过（阻塞）

| 检查项 | 验证方法 |
|--------|---------|
| DeepSeek 多轮 tool call 无 400 | 任务 B 执行时观察是否报错 |
| usage/cache 字段能落库 | `oc stats` 或 `oc export` 查看 tokens 字段 |
| hidden agents 走 small_model | 查看 title/summary/compaction 的 model 字段 |
| compaction 不报错 | 任务 C 触发 compaction 后无异常 |
| instructions 顺序稳定 | 两轮相同任务的 system prompt 前缀一致 |

### 期望通过（非阻塞）

| 检查项 | 目标值 |
|--------|--------|
| 热缓存 cache hit ratio | 明显高于冷缓存（期望 > 50%） |
| title/summary 使用 small_model | model 字段 = deepseek-chat（非 Pro） |
| 工具输出截断时有 error_summary | bash 失败时输出包含 `<error_summary>` |

---

## 测试任务

### Task A：只读分析任务（验证 explore agent + cache）

**目标**：梳理 DeepSeek provider 调用链，触发 explore agent，观察 cache hit。

**运行命令**：
```bash
# 第一轮（冷缓存）
oc run "梳理 packages/opencode/src/provider/transform.ts 中 DeepSeek 相关的处理逻辑，包括 reasoning_content、parallelToolCalls、reasoning_effort 三个部分，输出一份简洁的调用链说明" 2>&1 | tee /tmp/task-a-round1.log

# 第二轮（热缓存，相同任务）
oc run "梳理 packages/opencode/src/provider/transform.ts 中 DeepSeek 相关的处理逻辑，包括 reasoning_content、parallelToolCalls、reasoning_effort 三个部分，输出一份简洁的调用链说明" 2>&1 | tee /tmp/task-a-round2.log
```

**采集数据**：
```bash
# 查看最近两个 session 的 token 使用
oc stats
oc export  # 查看 tokens.cache.hit / tokens.cache.miss / tokens.cache.ratio
```

**记录表格**：

| 轮次 | agent | model | input | output | cache.hit | cache.miss | cache.ratio | 备注 |
|------|-------|-------|-------|--------|-----------|------------|-------------|------|
| 第一轮 | | | | | | | | 冷缓存 |
| 第二轮 | | | | | | | | 热缓存 |

---

### Task B：小型修改任务（验证 build agent + reasoning_content + tool call）

**目标**：做一个低风险代码改动，触发多轮 tool call，验证 P0 修复。

**运行命令**：
```bash
# 第一轮
oc run "在 packages/opencode/src/session/session.ts 的 getUsage 函数里，给 cache.ratio 的计算加一行注释，说明这个字段的含义和计算方式。只改注释，不改逻辑。" 2>&1 | tee /tmp/task-b-round1.log

# 第二轮（相似任务）
oc run "在 packages/opencode/src/session/session.ts 的 getUsage 函数里，给 promptCacheHitTokens 变量加一行注释，说明它来自 DeepSeek API 的哪个字段。只改注释，不改逻辑。" 2>&1 | tee /tmp/task-b-round2.log
```

**重点观察**：
- 是否有多轮 tool call（read → edit → 验证）
- 是否出现 400 错误（P0 回归检测）
- reasoning_content 是否正常（不报错）

**记录表格**：

| 轮次 | tool call 轮数 | 400 错误 | reasoning_content 正常 | cache.hit | cache.ratio |
|------|--------------|---------|----------------------|-----------|-------------|
| 第一轮 | | | | | |
| 第二轮 | | | | | |

---

### Task C：调试任务（验证 P2.5 工具输出摘要 + compaction）

**目标**：触发 bash 工具失败，验证 `<error_summary>` 注入；触发 compaction，验证 small_model。

**运行命令**：
```bash
# 第一轮：触发测试失败
oc run "运行 packages/opencode 目录下的测试，命令是 bun test test/provider/transform.test.ts，观察输出，告诉我有多少测试通过、多少失败。" 2>&1 | tee /tmp/task-c-round1.log

# 第二轮：相同任务（热缓存）
oc run "运行 packages/opencode 目录下的测试，命令是 bun test test/session/compaction.test.ts，观察输出，告诉我有多少测试通过、多少失败。" 2>&1 | tee /tmp/task-c-round2.log
```

**重点观察**：
- bash 输出是否包含 `<error_summary>` 块（P2.5）
- title agent 使用的 model 是否是 small_model
- 是否触发 compaction（如果 context 够长）

**记录表格**：

| 轮次 | bash 有 error_summary | title model | compaction 触发 | compaction model | cache.ratio |
|------|----------------------|-------------|----------------|-----------------|-------------|
| 第一轮 | | | | | |
| 第二轮 | | | | | |

---

## 数据采集方法

### 方法 1：oc stats
```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/apple/go-project/ai/opencode/packages/opencode
bun run --conditions=browser ./src/index.ts stats
```

### 方法 2：oc export（查看完整 session 数据）
```bash
# 列出最近 session
bun run --conditions=browser ./src/index.ts export <sessionID>
```

### 方法 3：直接查数据库
```bash
# opencode 数据库位置
DB="$HOME/.local/share/opencode/opencode.db"

# 查最近 session 的 token 使用
sqlite3 "$DB" "
SELECT
  id,
  substr(title, 1, 40) as title,
  tokens_input,
  tokens_output,
  tokens_cache_read as cache_hit,
  tokens_cache_write as cache_miss,
  CASE WHEN tokens_cache_read + tokens_cache_write > 0
    THEN round(tokens_cache_read * 100.0 / (tokens_cache_read + tokens_cache_write), 1)
    ELSE 0
  END as cache_ratio_pct,
  cost
FROM session
ORDER BY time_created DESC
LIMIT 10;
"
```

### 方法 4：查 message 级别数据
```bash
sqlite3 "$DB" "
SELECT
  m.id,
  json_extract(m.data, '$.agent') as agent,
  json_extract(m.data, '$.modelID') as model,
  json_extract(m.data, '$.tokens.input') as input,
  json_extract(m.data, '$.tokens.output') as output,
  json_extract(m.data, '$.tokens.cache.hit') as cache_hit,
  json_extract(m.data, '$.tokens.cache.miss') as cache_miss,
  json_extract(m.data, '$.tokens.cache.ratio') as cache_ratio
FROM message m
WHERE json_extract(m.data, '$.role') = 'assistant'
ORDER BY m.time_created DESC
LIMIT 20;
"
```

---

## 测试报告模板

测试完成后填写：

```
## P0-P3 集成测试报告

测试时间：____
测试模型：deepseek/deepseek-chat
测试环境：本地二开版本 (local)

### 必须通过项

| 检查项 | 结果 | 备注 |
|--------|------|------|
| DeepSeek 多轮 tool call 无 400 | ✅/❌ | |
| usage/cache 字段能落库 | ✅/❌ | |
| hidden agents 走 small_model | ✅/❌ | |
| compaction 不报错 | ✅/❌ | |
| instructions 顺序稳定 | ✅/❌ | |

### Telemetry 数据

| 任务 | 轮次 | input | output | cache.hit | cache.miss | ratio% | cost |
|------|------|-------|--------|-----------|------------|--------|------|
| A | 冷 | | | | | | |
| A | 热 | | | | | | |
| B | 冷 | | | | | | |
| B | 热 | | | | | | |
| C | 冷 | | | | | | |
| C | 热 | | | | | | |

### 发现的问题

1.
2.

### 结论

- P0 多轮 tool call：✅/❌
- P1a cache telemetry：✅/❌
- P1b reasoning_effort：✅/❌
- P1c small_model 路由：✅/❌
- P2.5 error_summary：✅/❌
- P3 instructions 排序：✅/❌

### 下一步建议

- [ ] 进入 P4
- [ ] 修复 P1/P3 问题后重测
- [ ] 继续观察 cache hit ratio（数据不足）
```

---

## 快速执行脚本

```bash
#!/bin/bash
# 保存为 run-test-matrix.sh
# 用法：bash run-test-matrix.sh

set -e
export PATH="$HOME/.bun/bin:$PATH"
OC_DIR="/Users/apple/go-project/ai/opencode/packages/opencode"
OC="bun run --conditions=browser ./src/index.ts"
DB="$HOME/.local/share/opencode/opencode.db"

cd "$OC_DIR"

echo "=== Task A Round 1 (冷缓存) ==="
$OC run "梳理 packages/opencode/src/provider/transform.ts 中 DeepSeek 相关的处理逻辑，包括 reasoning_content、parallelToolCalls、reasoning_effort 三个部分，输出一份简洁的调用链说明" 2>&1 | tee /tmp/oc-task-a-r1.log
echo "Task A Round 1 done"

echo "=== Task A Round 2 (热缓存) ==="
$OC run "梳理 packages/opencode/src/provider/transform.ts 中 DeepSeek 相关的处理逻辑，包括 reasoning_content、parallelToolCalls、reasoning_effort 三个部分，输出一份简洁的调用链说明" 2>&1 | tee /tmp/oc-task-a-r2.log
echo "Task A Round 2 done"

echo "=== Task B Round 1 ==="
$OC run "在 packages/opencode/src/session/session.ts 的 getUsage 函数里，给 cache.ratio 的计算加一行注释，说明这个字段的含义和计算方式。只改注释，不改逻辑。" 2>&1 | tee /tmp/oc-task-b-r1.log
echo "Task B Round 1 done"

echo "=== Task C Round 1 ==="
$OC run "运行 packages/opencode 目录下的测试，命令是 bun test test/provider/transform.test.ts，观察输出，告诉我有多少测试通过、多少失败。" 2>&1 | tee /tmp/oc-task-c-r1.log
echo "Task C Round 1 done"

echo ""
echo "=== Telemetry 数据 ==="
sqlite3 "$DB" "
SELECT
  substr(title, 1, 40) as title,
  tokens_input,
  tokens_output,
  tokens_cache_read as cache_hit,
  tokens_cache_write as cache_miss,
  CASE WHEN tokens_cache_read + tokens_cache_write > 0
    THEN round(tokens_cache_read * 100.0 / (tokens_cache_read + tokens_cache_write), 1)
    ELSE 0
  END as cache_ratio_pct,
  round(cost, 6) as cost
FROM session
ORDER BY time_created DESC
LIMIT 6;
"
```
