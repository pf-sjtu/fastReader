import type { MindElixirData, MindElixirInstance, Options } from "mind-elixir"
import MindElixir from "mind-elixir"
import "mind-elixir/style.css"
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from "react"
import { useIsDarkMode } from "../useTheme"

interface MindElixirReactProps {
  data: MindElixirData
  options?: Partial<Options>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugins?: any[]
  initScale?: number
  className?: string
  fitPage?: boolean
}

export interface MindElixirReactRef {
  instance: MindElixirInstance | null
}

// 进入视口前预留的提前量：滚动接近时就初始化，避免空白闪烁
const LAZY_ROOT_MARGIN = "200px"

const MindElixirReact = forwardRef<MindElixirReactRef, MindElixirReactProps>(
  ({ data, options, plugins, initScale, className, fitPage }, ref) => {
    const mindmapEl = useRef<HTMLDivElement>(null)
    const meInstance = useRef<MindElixirInstance | null>(null)
    const isDark = useIsDarkMode()
    // 无 IntersectionObserver 的环境（旧浏览器/测试）直接挂载
    const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined")

    // 初始化时读取最新值，但不让它们触发重建
    const latest = useRef({ data, fitPage, isDark, dataHash: "" })
    // 已应用到实例上的数据指纹，避免初始化后立刻重复 refresh
    const appliedHash = useRef("")

    // getter：实例是懒创建的，外部读取时始终拿到当前实例
    useImperativeHandle(ref, () => ({
      get instance() {
        return meInstance.current
      }
    }), [])

    // 简单数据指纹：只有根节点或一级子节点数变化才刷新
    const dataHash = useMemo(
      () =>
        data
          ? JSON.stringify(data.nodeData.id) +
            JSON.stringify(data.nodeData.topic) +
            (data.nodeData.children?.length || 0)
          : "",
      [data]
    )

    useEffect(() => {
      latest.current = { data, fitPage, isDark, dataHash }
    })

    // 懒挂载：进入视口才初始化（结果页每章一个实例，全部立即初始化开销很大）
    useEffect(() => {
      if (visible || !mindmapEl.current) return
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setVisible(true)
            observer.disconnect()
          }
        },
        { rootMargin: LAZY_ROOT_MARGIN }
      )
      observer.observe(mindmapEl.current)
      return () => observer.disconnect()
    }, [visible])

    // 创建实例；options 等变化时先 destroy 旧实例再重建，卸载时 destroy
    useEffect(() => {
      if (!visible || !mindmapEl.current) return
      const { data: initData, fitPage: initFit, isDark: initDark, dataHash: initHash } = latest.current

      const instance = new MindElixir({
        ...(options || {}),
        el: mindmapEl.current,
        theme: initDark ? MindElixir.DARK_THEME : MindElixir.THEME,
      })
      meInstance.current = instance

      if (plugins) {
        for (const plugin of plugins) {
          instance.install(plugin)
        }
      }

      if (initScale) {
        instance.scaleVal = initScale
        instance.map.style.transform = `scale(${initScale})`
      }

      if (initData) {
        appliedHash.current = initHash
        instance.init(initData)
        instance.toCenter()
        instance.scale(0.5)
        if (initFit) instance.scaleFit()
      }

      return () => {
        instance.destroy()
        if (meInstance.current === instance) meInstance.current = null
      }
    }, [visible, options, plugins, initScale])

    // 跟随应用内主题（ThemeProvider），而非仅系统主题
    useEffect(() => {
      meInstance.current?.changeTheme(isDark ? MindElixir.DARK_THEME : MindElixir.THEME)
    }, [isDark])

    // 使用 dataHash 作为依赖项，只有当数据真正变化时才刷新
    useEffect(() => {
      const instance = meInstance.current
      if (!instance || !dataHash || appliedHash.current === dataHash) return
      appliedHash.current = dataHash
      instance.refresh(latest.current.data)
      instance.toCenter()
      if (fitPage) instance.scaleFit()
    }, [dataHash, fitPage])

    return (
      <div
        ref={mindmapEl}
        className={className}
      />
    )
  }
)

MindElixirReact.displayName = "MindElixirReact"

export default MindElixirReact
