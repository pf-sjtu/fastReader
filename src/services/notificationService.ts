// 通知服务
import i18n from '../i18n'

export class NotificationService {
  private static instance: NotificationService

  private constructor() {}

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService()
    }
    return NotificationService.instance
  }

  // 请求通知权限
  async requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) {
      console.warn('此浏览器不支持桌面通知')
      return false
    }

    if (Notification.permission === 'granted') {
      return true
    }

    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission()
      return permission === 'granted'
    }

    return false
  }

  // 发送通知
  async sendNotification(title: string, options?: NotificationOptions): Promise<void> {
    const hasPermission = await this.requestPermission()
    
    if (!hasPermission) {
      console.warn('没有通知权限，无法发送通知')
      return
    }

    const defaultOptions: NotificationOptions = {
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: 'ebook-to-mindmap',
      requireInteraction: false,
      ...options
    }

    try {
      const notification = new Notification(title, defaultOptions)
      
      // 自动关闭通知（5秒后）
      setTimeout(() => {
        notification.close()
      }, 5000)

      // 点击通知时聚焦到窗口
      notification.onclick = () => {
        window.focus()
        notification.close()
      }
    } catch (error) {
      console.error('发送通知失败:', error)
    }
  }

  // 发送任务完成通知
  async sendTaskCompleteNotification(taskType: string, bookTitle?: string): Promise<void> {
    const title = i18n.t('notification.taskCompleteTitle')
    const message = bookTitle
      ? i18n.t('notification.taskCompleteBook', { task: taskType, book: bookTitle })
      : i18n.t('notification.taskComplete', { task: taskType })

    await this.sendNotification(title, {
      body: message,
      icon: '/favicon.svg'
    })
  }

  // 发送处理进度通知
  async sendProgressNotification(progress: number, currentStep: string): Promise<void> {
    const title = i18n.t('notification.progressTitle')
    const message = i18n.t('notification.progress', { progress, step: currentStep })

    await this.sendNotification(title, {
      body: message,
      icon: '/favicon.svg'
    })
  }

  // 发送错误通知
  async sendErrorNotification(error: string): Promise<void> {
    const title = i18n.t('notification.errorTitle')
    const message = i18n.t('notification.error', { error })

    await this.sendNotification(title, {
      body: message,
      icon: '/favicon.svg'
    })
  }

  // 检查是否支持通知
  isSupported(): boolean {
    return 'Notification' in window
  }

  // 检查是否有通知权限
  hasPermission(): boolean {
    return Notification.permission === 'granted'
  }
}

// 导出单例实例
export const notificationService = NotificationService.getInstance()
