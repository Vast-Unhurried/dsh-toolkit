# Changelog

## [1.0.0] - 2026-08-16

首发。

- 输入框工具行（Full access 选择器右侧）新增与周边图标同款的便签按钮（`conversation.input.left` 插槽）。
- 打开即新建便签；「保存」归档进历史并清空编辑区；关闭弹层时未保存内容自动存草稿防丢（下次打开恢复）。
- 「历史便签」弹出独立窗口：可拖拽、可缩放、记住最近一次的位置与大小（localStorage）。
- 历史条目点击展开/收起，展开时显示「复制」按钮；每条可单独删除；上限 30 条；相同内容去重。
- 宿主路由 `POST /plugins/dsh-note/api`（getNote / setNote / commitNote / deleteHistory / ping）；数据落盘 `$DSH_HOME/storages/dsh-note.json`（原子写、串行化）。
