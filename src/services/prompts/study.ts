/**
 * 学习功能提示词：速读包 / 自测 / 问书。
 * 共同约束：只依据给定材料，不编造；拿不准就省略或明说依据不足。
 */
import studyKitPrompt from './config/study-kit.md?raw'
import quizPrompt from './config/quiz.md?raw'
import askBookPrompt from './config/ask-book.md?raw'
import richRepairPrompt from './config/rich-repair.md?raw'

/** 提示词正文都在 config/*.md（前端与 CLI 共用的单一来源）；这里只负责取出。不要把提示词写回代码里（tests/promptsShared.test.ts 守卫） */
export const getStudyKitPrompt = (): string => studyKitPrompt.trim()
export const getQuizPrompt = (): string => quizPrompt.trim()
export const getAskBookPrompt = (): string => askBookPrompt.trim()
export const getRichRepairPrompt = (): string => richRepairPrompt.trim()
