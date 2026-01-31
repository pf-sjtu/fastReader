## MODIFIED Requirements
### Requirement: Batch Processing Dialog
系统 SHALL 在对话框展示文件列表时使用单次目录缓存列表进行“已处理”状态标记，避免逐文件 WebDAV 存在性检查。

#### Scenario: 文件列表缓存状态显示
- **GIVEN** 批量处理对话框已打开
- **WHEN** 系统加载目录文件列表
- **THEN** 系统只进行一次 WebDAV 缓存列表查询
- **AND** 基于本地缓存列表标记“已缓存/未处理”状态
