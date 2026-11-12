import { GROQ_CHAT_MODEL, GROQ_VISION_MODEL } from './groqConfig.js'

function getErrorCode(error) {
    return error?.code || error?.error?.code || error?.error?.error?.code
}

export function getPublicChatError(error) {
    const status = error?.status || error?.statusCode
    const code = getErrorCode(error)

    if (status === 404 && code === 'model_not_found') {
        return `The configured Groq model "${GROQ_CHAT_MODEL}" is unavailable. `
            + 'Check GROQ_CHAT_MODEL and your Groq model access.'
    }

    if (status === 401 || status === 403) {
        return 'Groq authentication failed. Verify the GROQ_API_KEY configured for the backend.'
    }

    if (status === 429) {
        return 'Groq rate limit reached. Wait briefly, then try again.'
    }

    if (status === 400) {
        return 'Groq rejected the chat request. Check the backend log for the provider error details.'
    }

    return 'The AI service could not complete the request. Check the backend logs and try again.'
}

export function getPublicVisionError(error) {
    const status = error?.status || error?.statusCode

    if (status === 404 && getErrorCode(error) === 'model_not_found') {
        return `The configured Groq vision model "${GROQ_VISION_MODEL}" is unavailable. `
            + 'Set GROQ_VISION_MODEL to an active vision model available to your account.'
    }

    if (status === 401 || status === 403) {
        return 'Groq authentication failed. Verify the GROQ_API_KEY configured for the backend.'
    }

    if (status === 429) {
        return 'Groq rate limit reached. Wait briefly, then try uploading the image again.'
    }

    return 'Groq could not analyze the image. Check the backend log and verify the vision model configuration.'
}
