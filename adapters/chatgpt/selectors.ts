export const CHATGPT_SELECTORS = {
  userMessage: '[data-message-author-role="user"]',
  assistantMessage: '[data-message-author-role="assistant"]',
  composer:
    '#prompt-textarea, textarea[data-id="root"], div[contenteditable="true"][data-testid*="composer"]',
  sendButton:
    'button[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="发送"]',
} as const;
