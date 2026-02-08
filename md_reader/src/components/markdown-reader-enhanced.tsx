import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from "remark-cjk-friendly";
import { normalizeMarkdownTypography } from '@/lib/markdown';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { 
  FileText, 
  Upload, 
  Eye, 
  Settings, 
  Cloud,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  RotateCcw
} from 'lucide-react';
import { DarkModeToggle } from './dark-mode-toggle';
import { FontSizeControl } from './font-size-control';
import { WebDAVFileBrowser } from './webdav-file-browser';
import { WebDAVSettingsDialog } from './webdav-settings-dialog';
import { useWebDAVConfig } from '../stores/webdavStore';
import { webdavService } from '../services/webdavService';
import { 
  X, UploadCloud, Replace
} from 'lucide-react';

interface MarkdownReaderProps {
  initialContent?: string;
  title?: string;
}

interface RecentFile {
  name: string;
  content: string;
  timestamp: number;
}

interface TocItem {
  id: string;
  title: string;
  level: number;
  children: TocItem[];
  isCollapsed?: boolean;
}

interface HeadingInfo {
  id: string;
  line: number;
  level: number;
  title: string;
}

export const MarkdownReaderEnhanced: React.FC<MarkdownReaderProps> = ({
  initialContent = '',
  title = 'Markdown 阅读器'
}) => {
  const [content, setContent] = useState(initialContent);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(initialContent);
  const [isDragging, setIsDragging] = useState(false);
  const [, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [, setRecentFiles] = useState<RecentFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reencodeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 新增状态
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [isTocCollapsed, setIsTocCollapsed] = useState(false);
  const [isReplaceDialogOpen, setIsReplaceDialogOpen] = useState(false);
  const [replaceText, setReplaceText] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [originalContent, setOriginalContent] = useState(initialContent);
  const [isSyncing, setIsSyncing] = useState(false);
  const [webdavFilePath, setWebdavFilePath] = useState<string | null>(null);
  
  // 标题ID映射状态
  const [, setHeadingsMap] = useState<Map<string, HeadingInfo>>(new Map());
  
  // 撤回功能相关状态
  const [editHistory, setEditHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // WebDAV相关状态
  const [isWebDAVBrowserOpen, setIsWebDAVBrowserOpen] = useState(false);
  const [isWebDAVSettingsOpen, setIsWebDAVSettingsOpen] = useState(false);
  const webdavConfig = useWebDAVConfig();

  // 统计信息
  const [stats, setStats] = useState({
    totalWords: 0,
    editedWords: 0,
    currentTime: new Date().toLocaleTimeString('zh-CN')
  });

  // 生成简单哈希函数
  const generateSimpleHash = (str: string): string => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  };

  // 预处理Markdown内容，将跨行标题转换为标准格式
  const preprocessMarkdown = useCallback((markdownContent: string): string => {
    const lines = markdownContent.split('\n');
    const processedLines: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headingMatch = line.match(/^(#{1,6})\s*$/);
      
      if (headingMatch) {
        // 当前行是只有 # 符号的标题行
        
        // 检查下一行是否有内容
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          const trimmedNextLine = nextLine.trim();
          
          // 如果下一行不是空行且不是标题，则合并
          if (trimmedNextLine && !trimmedNextLine.startsWith('#')) {
            processedLines.push(`${headingMatch[1]} ${trimmedNextLine}`);
            i++; // 跳过下一行，因为已经合并了
            continue;
          }
          
          // 如果下一行是空行，检查下下行
          if (!trimmedNextLine && i + 2 < lines.length) {
            const nextNextLine = lines[i + 2];
            const trimmedNextNextLine = nextNextLine.trim();
            
            if (trimmedNextNextLine && !trimmedNextNextLine.startsWith('#')) {
              processedLines.push(`${headingMatch[1]} ${trimmedNextNextLine}`);
              i += 2; // 跳过下两行
              continue;
            }
          }
        }
      }
      
      processedLines.push(line);
    }
    
    return processedLines.join('\n');
  }, []);

  // 扫描Markdown内容并生成标题ID映射
  const scanAndEncodeHeadings = useCallback((markdownContent: string): Map<string, HeadingInfo> => {
    const lines = markdownContent.split('\n');
    const headingsMap = new Map<string, HeadingInfo>();
    
    lines.forEach((line, index) => {
      // 支持跨行标题 - 检查当前行是否只有 # 符号
      const headingMatch = line.match(/^(#{1,6})\s*(.*)$/);
      
      if (headingMatch) {
        const level = headingMatch[1].length;
        let title = headingMatch[2].trim();
        
        // 如果当前行只有 # 符号，检查下一行是否有标题内容
        if (!title && index + 1 < lines.length) {
          const nextLine = lines[index + 1].trim();
          if (nextLine && !nextLine.startsWith('#')) {
            title = nextLine;
          }
        }
        
        // 如果当前行只有 # 符号且下一行是空行，检查下下行是否有标题内容
        if (!title && index + 2 < lines.length) {
          const nextLine = lines[index + 1].trim();
          const nextNextLine = lines[index + 2].trim();
          if (!nextLine && nextNextLine && !nextNextLine.startsWith('#')) {
            title = nextNextLine;
          }
        }
        
        // 如果仍然没有标题，跳过
        if (!title) {
          return;
        }
        
        // 去除标题中的格式标记（加粗、斜体、下划线等）
        const cleanTitle = title
          .replace(/\*\*(.*?)\*\*/g, '$1') // 去除加粗
          .replace(/\*(.*?)\*/g, '$1') // 去除斜体
          .replace(/_(.*?)_/g, '$1') // 去除下划线
          .replace(/`(.*?)`/g, '$1') // 去除行内代码
          .replace(/\[(.*?)\]\(.*?\)/g, '$1') // 去除链接，保留文本
          .trim();

        // 生成唯一的ID，使用行号和标题文本哈希
        const titleHash = generateSimpleHash(cleanTitle);
        const id = `heading-${index}-${titleHash}`;

        const headingInfo: HeadingInfo = {
          id,
          line: index,
          level,
          title: cleanTitle
        };

        headingsMap.set(id, headingInfo);
      }
    });

    return headingsMap;
  }, []);

  // 基于标题映射生成目录
  const generateTocFromMap = useCallback((headingsMap: Map<string, HeadingInfo>): TocItem[] => {
    const items: TocItem[] = [];
    const stack: TocItem[] = [];

    // 按行号排序标题
    const sortedHeadings = Array.from(headingsMap.values()).sort((a, b) => a.line - b.line);

    sortedHeadings.forEach(heading => {
      // 只显示一级（#）和二级（##）标题，忽略三级（###）及以下级别的标题
      if (heading.level > 2) {
        return;
      }

      // 设置默认折叠状态：二级标题默认展开
      const isCollapsed = heading.level >= 3; // 虽然不会显示三级，但保留逻辑

      const item: TocItem = {
        id: heading.id,
        title: heading.title,
        level: heading.level,
        children: [],
        isCollapsed
      };

      // 构建树形结构
      while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
        stack.pop();
      }

      if (stack.length === 0) {
        items.push(item);
      } else {
        stack[stack.length - 1].children.push(item);
      }

      stack.push(item);
    });

    return items;
  }, []);

  // 自定义组件映射
  const components: Components = {
    h1: ({ children, ...props }) => <h1 {...props}>{children}</h1>,
    h2: ({ children, ...props }) => <h2 {...props}>{children}</h2>,
    h3: ({ children, ...props }) => <h3 {...props}>{children}</h3>,
    h4: ({ children, ...props }) => <h4 {...props}>{children}</h4>,
    h5: ({ children, ...props }) => <h5 {...props}>{children}</h5>,
    h6: ({ children, ...props }) => <h6 {...props}>{children}</h6>,
  };

  // Load recent files from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('recentMarkdownFiles');
    if (stored) {
      try {
        setRecentFiles(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to load recent files:', e);
      }
    }
  }, []);

  // 更新时间
  useEffect(() => {
    const timer = setInterval(() => {
      setStats(prev => ({
        ...prev,
        currentTime: new Date().toLocaleTimeString('zh-CN')
      }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 更新统计信息
  useEffect(() => {
    const totalWords = content.length;
    // 使用editContent与originalContent比较，因为content是预处理后的
    const editedWords = Math.abs(editContent.length - originalContent.length);
    setStats(prev => ({
      ...prev,
      totalWords,
      editedWords
    }));
  }, [content, editContent, originalContent]);

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isEditing) {
        if (e.ctrlKey && e.key === 'h') {
          e.preventDefault();
          setIsReplaceDialogOpen(true);
        }
        return;
      }

      if (e.ctrlKey && e.key === 'h') {
        e.preventDefault();
        setIsReplaceDialogOpen(true);
      } else if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        // 直接在 effect 内执行保存逻辑，避免外部函数依赖警告
        const processedText = preprocessMarkdown(editContent);
        const normalized = normalizeMarkdownTypography(processedText);

        setContent(normalized);
        setIsEditing(false);
        setEditHistory([editContent]);
        setHistoryIndex(0);

        const newHeadingsMap = scanAndEncodeHeadings(normalized);
        setHeadingsMap(newHeadingsMap);
        setTocItems(generateTocFromMap(newHeadingsMap));

        if (fileName) {
          addToRecentFiles(fileName, editContent);
        }
      } else if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        // 直接在 effect 内执行撤回逻辑，避免外部函数依赖警告
        if (historyIndex > 0) {
          const newIndex = historyIndex - 1;
          setHistoryIndex(newIndex);
          setEditContent(editHistory[newIndex]);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    isEditing,
    editContent,
    fileName,
    historyIndex,
    editHistory,
    addToRecentFiles,
    preprocessMarkdown,
    scanAndEncodeHeadings,
    generateTocFromMap
  ]);

  // 添加到编辑历史
  const addToHistory = useCallback((newContent: string) => {
    setEditHistory(prev => {
      // 如果内容没有变化，不添加到历史
      if (prev.length > 0 && prev[prev.length - 1] === newContent) {
        return prev;
      }
      
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(newContent);
      // 最多保留10条历史记录
      return newHistory.slice(-10);
    });
    setHistoryIndex(prev => Math.min(prev + 1, 9));
  }, [historyIndex]);

  // 撤回功能
  const handleUndo = useCallback(() => {
    console.log('撤回操作 - 当前历史索引:', historyIndex, '历史长度:', editHistory.length);
    
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setEditContent(editHistory[newIndex]);
      console.log('撤回到索引:', newIndex, '内容:', editHistory[newIndex]?.substring(0, 50) + '...');
    } else {
      console.log('无法撤回：已在最早的历史记录');
    }
  }, [historyIndex, editHistory]);

  // 切换目录项折叠状态
  const toggleTocItemCollapse = (itemId: string) => {
    const updateCollapseState = (items: TocItem[]): TocItem[] => {
      return items.map(item => {
        if (item.id === itemId) {
          return { ...item, isCollapsed: !item.isCollapsed };
        }
        if (item.children.length > 0) {
          return { ...item, children: updateCollapseState(item.children) };
        }
        return item;
      });
    };
    
    setTocItems(prev => updateCollapseState(prev));
  };

  // 一键折叠/展开所有目录项
  const toggleAllTocItems = (collapse: boolean) => {
    const updateAllCollapseState = (items: TocItem[]): TocItem[] => {
      return items.map(item => ({
        ...item,
        isCollapsed: collapse,
        children: updateAllCollapseState(item.children)
      }));
    };
    
    setTocItems(prev => updateAllCollapseState(prev));
    setIsTocCollapsed(collapse);
  };

  // 重置为默认折叠状态（二级展开，三级及之后折叠）
  const resetTocToDefault = () => {
    const resetToDefaultState = (items: TocItem[]): TocItem[] => {
      return items.map(item => ({
        ...item,
        isCollapsed: item.level >= 3,
        children: resetToDefaultState(item.children)
      }));
    };
    
    setTocItems(prev => resetToDefaultState(prev));
    setIsTocCollapsed(false);
  };

  const addToRecentFiles = useCallback((name: string, content: string) => {
    const newFile: RecentFile = {
      name,
      content,
      timestamp: Date.now()
    };

    setRecentFiles(prev => {
      const filtered = prev.filter(f => f.name !== name);
      const updated = [newFile, ...filtered].slice(0, 10); // 保留最近10个文件
      localStorage.setItem('recentMarkdownFiles', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const validateFile = (file: File): boolean => {
    const validTypes = ['.md', '.markdown', '.txt'];
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
    
    if (!validTypes.includes(fileExtension)) {
      setError('不支持的文件类型，请上传 .md、.markdown 或 .txt 文件');
      return false;
    }

    if (file.size > 10 * 1024 * 1024) { // 10MB
      setError('文件大小超过10MB，请选择较小的文件');
      return false;
    }

    return true;
  };

  const processFile = useCallback((file: File, filePath?: string) => {
    setError(null);
    
    if (!validateFile(file)) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      
      // 预处理Markdown内容，将跨行标题转换为标准格式
      const processedText = preprocessMarkdown(text);
      const normalized = normalizeMarkdownTypography(processedText);
      
      setContent(normalized);
      setEditContent(text); // 编辑时仍使用原始内容
      setOriginalContent(text);
      setFileName(file.name);
      setWebdavFilePath(filePath || null);
      addToRecentFiles(file.name, text);
      
      // 初始化编辑历史
      setEditHistory([text]);
      setHistoryIndex(0);
      
      // 扫描并编码标题ID（使用预处理后的内容）
      const headingsMap = scanAndEncodeHeadings(normalized);
      setHeadingsMap(headingsMap);
      
      // 生成目录
      const tocItems = generateTocFromMap(headingsMap);
      setTocItems(tocItems);
      
      clearError();
    };
    
    reader.onerror = () => {
      setError('文件读取失败，请重试');
    };
    
    reader.readAsText(file);
  }, [
    addToRecentFiles,
    preprocessMarkdown,
    scanAndEncodeHeadings,
    generateTocFromMap
  ]);

  // 处理WebDAV文件选择
  const handleWebDAVFileSelect = useCallback((file: File, filePath?: string) => {
    processFile(file, filePath);
  }, [processFile]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      processFile(files[0]);
    }
  }, [processFile]);

  const clearError = () => {
    setError(null);
  };

  const clearFile = () => {
    setContent('');
    setEditContent('');
    setOriginalContent('');
    setFileName(null);
    setWebdavFilePath(null);
    setError(null);
    setEditHistory([]);
    setHistoryIndex(-1);
    
    // 清空标题映射和目录
    setHeadingsMap(new Map());
    setTocItems([]);
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleStartEdit = () => {
    setIsEditing(true);
    // 初始化历史记录为当前内容
    setEditHistory([editContent]);
    setHistoryIndex(0);
    console.log('开始编辑，初始化历史记录');
  };

  // 保存编辑
  const handleSaveEdit = () => {
    // 预处理编辑后的内容
    const processedText = preprocessMarkdown(editContent);
    const normalized = normalizeMarkdownTypography(processedText);
    
    setContent(normalized);
    setIsEditing(false);
    // 保存后重置历史记录
    setEditHistory([editContent]);
    setHistoryIndex(0);
    console.log('保存编辑，重置历史记录');
    
    // 重新扫描并编码标题ID（使用预处理后的内容）
    const headingsMap = scanAndEncodeHeadings(normalized);
    setHeadingsMap(headingsMap);
    
    // 重新生成目录
    const tocItems = generateTocFromMap(headingsMap);
    setTocItems(tocItems);
    
    // 更新最近文件记录
    if (fileName) {
      addToRecentFiles(fileName, editContent);
    }
  };

  // 取消编辑
  const handleCancelEdit = () => {
    setEditContent(content);
    setIsEditing(false);
  };

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (editTimeoutRef.current) {
        clearTimeout(editTimeoutRef.current);
        editTimeoutRef.current = null;
      }
      if (reencodeTimeoutRef.current) {
        clearTimeout(reencodeTimeoutRef.current);
        reencodeTimeoutRef.current = null;
      }
    };
  }, []);

  // 处理编辑内容变化
  const handleEditContentChange = (newContent: string) => {
    setEditContent(newContent);
    
    // 清理之前的定时器
    if (editTimeoutRef.current) {
      clearTimeout(editTimeoutRef.current);
    }

    // 防抖处理
    editTimeoutRef.current = setTimeout(() => {
      addToHistory(newContent);
    }, 1000);

    // 清理之前的重新编码定时器
    if (reencodeTimeoutRef.current) {
      clearTimeout(reencodeTimeoutRef.current);
    }

    // 防抖重新编码标题ID
    reencodeTimeoutRef.current = setTimeout(() => {
      // 预处理编辑后的内容用于标题扫描
      const processedText = preprocessMarkdown(newContent);
      const normalized = normalizeMarkdownTypography(processedText);
      const headingsMap = scanAndEncodeHeadings(normalized);
      setHeadingsMap(headingsMap);
      
      const tocItems = generateTocFromMap(headingsMap);
      setTocItems(tocItems);

      setContent(normalized);
    }, 1000); // 1秒防抖，避免频繁重新编码
  };

  // 替换文本功能
  const handleReplace = () => {
    if (!replaceText) return;
    
    const newContent = editContent.replace(new RegExp(replaceText, 'g'), replaceWith);
    const processedText = preprocessMarkdown(newContent);
    const normalized = normalizeMarkdownTypography(processedText);
    setEditContent(newContent);
    setContent(normalized);
    setIsReplaceDialogOpen(false);
    setReplaceText('');
    setReplaceWith('');
  };

  // 同步到云端功能
  const handleSyncToCloud = async () => {
    if (!webdavConfig.enabled || !webdavFilePath || !fileName) {
      setError('无法同步：WebDAV未配置或文件不是从云端打开的');
      return;
    }

    if (stats.editedWords === 0) {
      setError('文件没有修改，无需同步');
      return;
    }

    setIsSyncing(true);
    setError(null);

    try {
      console.log('开始同步文件到云端:', webdavFilePath);
      
      // 确保WebDAV服务已初始化
      if (!webdavService.isInitialized()) {
        const initResult = await webdavService.initialize(webdavConfig);
        if (!initResult.success) {
          throw new Error(initResult.error || 'WebDAV服务初始化失败');
        }
      }
      
      // 上传文件内容
      const uploadResult = await webdavService.putFileContents(webdavFilePath, content, true);
      
      if (!uploadResult.success) {
        throw new Error(uploadResult.error || '上传失败');
      }
      
      // 更新原始内容标记
      setOriginalContent(content);
      
      // 显示成功消息
      console.log('文件同步成功');
      
    } catch (error) {
      console.error('同步失败:', error);
      setError(`同步失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // 渲染目录树
  const renderTocItem = (item: TocItem, level: number = 0) => {
    const paddingLeft = `${level * 16}px`;
    const hasChildren = item.children.length > 0;
    
    return (
      <div key={item.id}>
        <div
          className="flex items-center gap-1 py-1 px-2 hover:bg-muted/50 rounded cursor-pointer text-sm group"
          style={{ paddingLeft }}
        >
          {/* 折叠/展开图标 */}
          {hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleTocItemCollapse(item.id);
              }}
              className="h-4 w-4 p-0 hover:bg-muted rounded transition-transform duration-200"
              style={{ transform: item.isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
            >
              <ChevronDown className="h-3 w-3" />
            </button>
          )}
          
          {/* 标题文本 */}
          <div
            className="flex-1 flex items-center gap-1"
            onClick={() => {
              // 使用预编码的ID直接跳转
              const targetElement = document.getElementById(item.id);
              
              if (targetElement) {
                // 滚动到目标位置
                targetElement.scrollIntoView({ 
                  behavior: 'smooth',
                  block: 'start'
                });
                
                // 高亮效果
                targetElement.classList.add('highlighted-heading');
                setTimeout(() => {
                  targetElement.classList.remove('highlighted-heading');
                }, 2000);
              }
            }}
          >
            <span className="truncate">{item.title}</span>
          </div>
        </div>
        
        {/* 子项 */}
        {hasChildren && !item.isCollapsed && (
          <div className="ml-2">
            {item.children.map(child => renderTocItem(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background relative">
      {/* 左侧抽屉导航 - 悬浮层 */}
      <div className={`fixed left-0 top-0 h-full bg-background border-r shadow-lg z-50 transition-all duration-300 ${
        isDrawerOpen ? 'w-64' : 'w-0'
      } overflow-hidden`}>
        <div className="p-4 h-full flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-sm">目录</h3>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={resetTocToDefault}
                className="h-6 w-6 p-0"
                title="重置为默认状态"
              >
                <RotateCcw className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggleAllTocItems(!isTocCollapsed)}
                className="h-6 w-6 p-0"
                title={isTocCollapsed ? "展开所有" : "折叠所有"}
              >
                {isTocCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto">
            {tocItems.length > 0 ? (
              <div className="space-y-1">
                {tocItems.map(item => renderTocItem(item))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">暂无目录</p>
            )}
          </div>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className={`transition-all duration-300 ${isDrawerOpen ? 'ml-64' : 'ml-0'}`}>
        <div className="flex flex-col h-screen">
          {/* 简化的标题栏 - 只显示标题和文件名 */}
          <div className="p-4 pb-2">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <h1 className="text-lg font-semibold">{title}</h1>
              {fileName && (
                <span className="text-sm text-muted-foreground">
                  - {fileName}
                </span>
              )}
            </div>
          </div>

        {/* 内容区域 */}
        <div className="flex-1 p-4 pt-2 pb-24">
          {content ? (
            <Card className="h-full">
              <CardContent className="p-4 h-full">
                {isEditing ? (
                  <div className="h-full flex flex-col">
                    <textarea
                      value={editContent}
                      onChange={(e) => {
                        handleEditContentChange(e.target.value)
                      }}
                      className="flex-1 w-full p-4 border rounded-md bg-background text-foreground font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="在此输入 Markdown 内容..."
                    />
                    <div className="flex gap-2 mt-4">
                      <Button onClick={handleSaveEdit} size="sm">
                        保存 (Ctrl+S)
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleCancelEdit}
                        size="sm"
                      >
                        取消
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleUndo}
                        size="sm"
                        disabled={historyIndex <= 0}
                        className="flex items-center gap-2"
                      >
                        撤回 (Ctrl+Z)
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="h-full overflow-y-auto markdown-content prose prose-sm max-w-none">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkCjkFriendly]}
                      components={components}
                    >
                      {content}
                    </ReactMarkdown>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card
              className={`h-full flex items-center justify-center cursor-pointer transition-all ${
                isDragging
                  ? 'border-primary border-2 bg-primary/5'
                  : 'border-dashed border-2'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <CardContent className="p-8 text-center">
                <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">
                  {isDragging ? '释放文件以打开' : '欢迎使用 Markdown 阅读器'}
                </h3>
                <p className="text-muted-foreground mb-4">
                  {isDragging
                    ? '拖拽 Markdown 文件到这里'
                    : '上传 Markdown 文件、拖拽文件到此处或直接编辑内容开始使用'
                  }
                </p>
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>支持的功能：</p>
                  <p>• 🌙 深色/浅色模式切换</p>
                  <p>• 📝 字体大小调节</p>
                  <p>• 📄 Markdown 实时预览</p>
                  <p>• 🎨 优雅的样式和高亮</p>
                  <p>• 🖱️ 拖拽文件支持</p>
                  <p>• 🕐 最近文件历史</p>
                  <p>• ☁️ WebDAV云端文件访问</p>
                  <p>• 📋 目录导航</p>
                  <p>• 🔄 文本替换功能</p>
                  <p>• ☁️ 云端同步</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>


        {/* 悬浮底部状态栏 */}
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-t shadow-lg">
          <div className="px-2 py-1">
            {/* 主要操作按钮区域 */}
            <div className="flex items-center justify-between mb-1">
              {/* 左侧：目录和基础控制 */}
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsDrawerOpen(!isDrawerOpen)}
                  className="h-7 w-7 p-0"
                  title={isDrawerOpen ? "收起目录" : "展开目录"}
                >
                  {isDrawerOpen ? <ChevronLeft className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </Button>
                
                <div className="w-px h-4 bg-border mx-1" />
                
                <FontSizeControl variant="minimal" />
                <DarkModeToggle />
              </div>
              
              {/* 中间：文件操作按钮 */}
              <div className="flex items-center gap-1">
                <label htmlFor="file-upload-bottom">
                  <Button variant="ghost" size="sm" asChild className="h-7 px-2">
                    <span className="flex items-center gap-1 cursor-pointer" title="上传文件">
                      <Upload className="h-3 w-3" />
                      <span className="text-xs">上传</span>
                    </span>
                  </Button>
                </label>
                <input
                  id="file-upload-bottom"
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.markdown,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (webdavConfig.enabled) {
                      setIsWebDAVBrowserOpen(true)
                    } else {
                      setIsWebDAVSettingsOpen(true)
                    }
                  }}
                  className="h-7 px-2"
                  title={webdavConfig.enabled ? "从WebDAV打开" : "请先在设置中启用WebDAV"}
                >
                  <Cloud className="h-3 w-3" />
                  <span className="text-xs ml-1">WebDAV</span>
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsWebDAVSettingsOpen(true)}
                  className="h-7 px-2"
                  title="WebDAV设置"
                >
                  <Settings className="h-3 w-3" />
                </Button>
                
                {content && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => isEditing ? handleSaveEdit() : handleStartEdit()}
                      className="h-7 px-2"
                      title={isEditing ? "预览" : "编辑"}
                    >
                      <Eye className="h-3 w-3" />
                      <span className="text-xs ml-1">{isEditing ? '预览' : '编辑'}</span>
                    </Button>
                    
                    {webdavConfig.enabled && webdavFilePath && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleSyncToCloud}
                        disabled={isSyncing || stats.editedWords === 0}
                        className="h-7 px-2"
                        title="同步到云端"
                      >
                        <UploadCloud className="h-3 w-3" />
                        <span className="text-xs ml-1">{isSyncing ? '同步中' : '同步'}</span>
                      </Button>
                    )}
                    
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearFile}
                      className="h-7 px-2"
                      title="清除文件"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </>
                )}
              </div>
              
              {/* 右侧：编辑工具 */}
              <div className="flex items-center gap-1">
                {isEditing && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsReplaceDialogOpen(true)}
                      className="h-7 px-2"
                      title="替换文本 (Ctrl+H)"
                    >
                      <Replace className="h-3 w-3" />
                    </Button>
                    
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleUndo}
                      disabled={historyIndex <= 0}
                      className="h-7 px-2"
                      title="撤回 (Ctrl+Z)"
                    >
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  </>
                )}
              </div>
            </div>
            
            {/* 状态信息区域 */}
            <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-1">
              <div className="flex items-center gap-3">
                <span>字数: {stats.totalWords}</span>
                {stats.editedWords > 0 && (
                  <span className="text-orange-600">+{stats.editedWords}</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {fileName && <span className="truncate max-w-32">{fileName}</span>}
                <span>{stats.currentTime}</span>
              </div>
            </div>
          </div>
        </div>
    </div>
      </div>

      {/* WebDAV文件浏览器对话框 */}
      <WebDAVFileBrowser
        isOpen={isWebDAVBrowserOpen}
        onClose={() => setIsWebDAVBrowserOpen(false)}
        onFileSelect={handleWebDAVFileSelect}
        allowedExtensions={['.md', '.markdown', '.txt']}
      />

      {/* WebDAV设置对话框 */}
      <WebDAVSettingsDialog
        isOpen={isWebDAVSettingsOpen}
        onClose={() => setIsWebDAVSettingsOpen(false)}
      />

      {/* 替换文本对话框 */}
      <Dialog open={isReplaceDialogOpen} onOpenChange={setIsReplaceDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>替换文本</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="replace-text">查找文本</Label>
              <Input
                id="replace-text"
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                placeholder="输入要替换的文本"
              />
            </div>
            <div>
              <Label htmlFor="replace-with">替换为</Label>
              <Input
                id="replace-with"
                value={replaceWith}
                onChange={(e) => setReplaceWith(e.target.value)}
                placeholder="输入替换后的文本"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleReplace} disabled={!replaceText}>
                替换全部
              </Button>
              <Button variant="outline" onClick={() => setIsReplaceDialogOpen(false)}>
                取消
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* CSS样式 */}
      <style dangerouslySetInnerHTML={{
        __html: `
          .highlighted-heading {
            background-color: yellow;
            transition: background-color 0.3s ease;
          }
        `
      }} />
    </div>
  );
};
