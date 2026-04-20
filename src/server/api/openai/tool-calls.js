/**
 * @fileoverview 工具调用处理模块
 * @description 解析 AI 响应中的工具调用，执行工具并返回结果
 */

import { logger } from '../../../utils/logger.js';

/**
 * 检测 AI 响应是否包含工具调用意图
 * @param {string} content - AI 返回的文本内容
 * @param {Array} tools - 工具定义数组
 * @returns {{hasToolCall: boolean, toolName?: string, args?: object}}
 */
export function detectToolCall(content, tools) {
    if (!tools || !Array.isArray(tools) || tools.length === 0) {
        return { hasToolCall: false };
    }

    // 尝试从内容中提取 JSON 格式的工具调用（优先匹配代码块）
    const codeBlockPattern = /```json\s*([\s\S]*?)\s*```/g;
    let match;
    
    while ((match = codeBlockPattern.exec(content)) !== null) {
        try {
            const jsonStr = match[1];
            const parsed = JSON.parse(jsonStr);
            
            // 检查是否包含工具调用信息
            if (parsed.tool && parsed.arguments !== undefined) {
                const toolName = parsed.tool;
                const args = parsed.arguments;
                
                // 验证工具是否存在
                const toolExists = tools.some(t => 
                    t.type === 'function' && t.function.name === toolName
                );
                
                if (toolExists) {
                    logger.info('工具调用', `检测到工具调用: ${toolName}`, { args });
                    return {
                        hasToolCall: true,
                        toolName,
                        args
                    };
                }
            }
        } catch (e) {
            logger.debug('工具调用', `JSON 解析失败: ${e.message}`);
        }
    }

    // 备用：尝试直接匹配 JSON 对象（无代码块）
    const directJsonPattern = /\{\s*"tool"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[^}]+\})\s*\}/g;
    while ((match = directJsonPattern.exec(content)) !== null) {
        try {
            const toolName = match[1];
            const argsStr = match[2];
            const args = JSON.parse(argsStr);
            
            const toolExists = tools.some(t => 
                t.type === 'function' && t.function.name === toolName
            );
            
            if (toolExists) {
                logger.info('工具调用', `通过直接 JSON 匹配检测到工具调用: ${toolName}`, { args });
                return {
                    hasToolCall: true,
                    toolName,
                    args
                };
            }
        } catch (e) {
            logger.debug('工具调用', `直接 JSON 解析失败: ${e.message}`);
        }
    }

    // 新增：匹配 "Tool: xxx\nArguments: {...}" 格式（不区分大小写）
    const textFormatPattern = /[Tt]ool:\s*([\w_-]+)\s*\n\s*[Aa]rguments:\s*(\{[\s\S]*?\})(?=\s*\n|$)/g;
    while ((match = textFormatPattern.exec(content)) !== null) {
        try {
            const toolName = match[1].trim();
            const argsStr = match[2].trim();
            const args = JSON.parse(argsStr);
            
            const toolExists = tools.some(t => 
                t.type === 'function' && t.function.name === toolName
            );
            
            if (toolExists) {
                logger.info('工具调用', `通过文本格式匹配检测到工具调用: ${toolName}`, { args });
                return {
                    hasToolCall: true,
                    toolName,
                    args
                };
            }
        } catch (e) {
            logger.debug('工具调用', `文本格式解析失败: ${e.message}`);
        }
    }

    return { hasToolCall: false };
}



/**
 * 构建 OpenAI 格式的工具调用响应
 * @param {string} toolName - 工具名称
 * @param {object} args - 工具参数
 * @param {string} callId - 调用 ID
 * @returns {object} OpenAI 格式的响应
 */
export function buildToolCallResponse(toolName, args, callId) {
    const toolCallId = callId || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'default-model',
        choices: [{
            index: 0,
            message: {
                role: 'assistant',
                content: null,
                tool_calls: [{
                    id: toolCallId,
                    type: 'function',
                    function: {
                        name: toolName,
                        arguments: JSON.stringify(args)
                    }
                }]
            },
            finish_reason: 'tool_calls'
        }]
    };
}

/**
 * 构建流式工具调用响应块
 * @param {string} toolName - 工具名称
 * @param {object} args - 工具参数
 * @param {string} callId - 调用 ID
 * @returns {object[]} 流式响应块数组
 */
export function buildStreamingToolCallResponse(toolName, args, callId) {
    const toolCallId = callId || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const chunks = [];
    
    // 第一个块：开始 delta
    chunks.push({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'default-model',
        choices: [{
            index: 0,
            delta: {
                role: 'assistant',
                content: null,
                tool_calls: [{
                    index: 0,
                    id: toolCallId,
                    type: 'function',
                    function: {
                        name: toolName,
                        arguments: ''
                    }
                }]
            },
            finish_reason: null
        }]
    });
    
    // 第二个块：传递参数
    const argsStr = JSON.stringify(args);
    chunks.push({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'default-model',
        choices: [{
            index: 0,
            delta: {
                tool_calls: [{
                    index: 0,
                    function: {
                        arguments: argsStr
                    }
                }]
            },
            finish_reason: null
        }]
    });
    
    // 第三个块：结束
    chunks.push({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'default-model',
        choices: [{
            index: 0,
            delta: {},
            finish_reason: 'tool_calls'
        }]
    });
    
    return chunks;
}

/**
 * 构建工具执行结果的响应（用于多轮对话）
 * @param {string} toolCallId - 工具调用 ID
 * @param {*} result - 工具执行结果
 * @returns {object} 用户消息格式
 */
export function buildToolResultMessage(toolCallId, result) {
    return {
        role: 'tool',
        tool_call_id: toolCallId,
        content: typeof result === 'string' ? result : JSON.stringify(result)
    };
}
