import {handleMessage} from './message.js';
import {DATABASE, ENV} from './env.js';
import {bindCommandForTelegram, commandsDocument} from './command.js';
import {bindTelegramWebHook, getBot} from './telegram.js';
import {errorToString, historyPassword, renderHTML} from './utils.js';
import {gpt3TokensCounter} from './gpt3.js';


const helpLink = 'https://github.com/TBXark/ChatGPT-Telegram-Workers/blob/master/DEPLOY.md';
const issueLink = 'https://github.com/TBXark/ChatGPT-Telegram-Workers/issues';
const initLink = './init';

const footer = `
<br/>
<p>For more information, please visit <a href="${helpLink}">${helpLink}</a></p>
<p>If you have any questions, please visit <a href="${issueLink}">${issueLink}</a></p>
`;

function buildKeyNotFoundHTML(key) {
  return `<p style="color: red">Please set the <strong>${key}</strong> environment variable in Cloudflare Workers.</p> `;
}

async function bindWebHookAction(request) {
  const result = [];
  const domain = new URL(request.url).host;
  for (const token of ENV.TELEGRAM_AVAILABLE_TOKENS) {
    const url = `https://${domain}/telegram/${token.trim()}/webhook`;
    const id = token.split(':')[0];
    result[id] = {
      webhook: await bindTelegramWebHook(token, url).catch((e) => errorToString(e)),
      command: await bindCommandForTelegram(token).catch((e) => errorToString(e)),
    };
  }

  const HTML = renderHTML(`
    <h1>ChatGPT-Telegram-Workers</h1>
    <h2>${domain}</h2>
    ${
  ENV.TELEGRAM_AVAILABLE_TOKENS.length === 0 ? buildKeyNotFoundHTML('TELEGRAM_AVAILABLE_TOKENS') : ''
}
    ${
  Object.keys(result).map((id) => `
        <br/>
        <h4>Bot ID: ${id}</h4>
        <p style="color: ${result[id].webhook.ok ? 'green' : 'red'}">Webhook: ${JSON.stringify(result[id].webhook)}</p>
        <p style="color: ${result[id].command.ok ? 'green' : 'red'}">Command: ${JSON.stringify(result[id].command)}</p>
        `).join('')

}
      ${footer}
    `);
  return new Response(HTML, {status: 200, headers: {'Content-Type': 'text/html'}});
}

async function loadChatHistory(request) {
  const password = await historyPassword();
  const {pathname} = new URL(request.url);
  const historyKey = pathname.match(/^\/telegram\/(.+)\/history/)[1];
  const params = new URL(request.url).searchParams;
  const passwordParam = params.get('password');
  if (passwordParam !== password) {
    return new Response('Password Error', {status: 401});
  }
  const history = JSON.parse(await DATABASE.get(historyKey));
  const HTML = renderHTML(`
        <div id="history" style="width: 100%; height: 100%; overflow: auto; padding: 10px;">
            ${history.map((item) => `
                <div style="margin-bottom: 10px;">
                    <hp style="font-size: 16px; color: #999; margin-bottom: 5px;">${item.role}:</hp>
                    <p style="font-size: 12px; color: #333;">${item.content}</p>
                </div>
            `).join('')}
        </div>
  `);
  return new Response(HTML, {status: 200, headers: {'Content-Type': 'text/html'}});
}

// 处理Telegram回调
async function telegramWebhook(request) {
  const resp = await handleMessage(request);
  return resp || new Response('NOT HANDLED', {status: 200});
}

async function defaultIndexAction() {
  const HTML = renderHTML(`
    <h1>ChatGPT-Telegram-Workers</h1>
    <br/>
    <p>Deployed Successfully!</p>
    <p> Version (ts:${ENV.BUILD_TIMESTAMP},sha:${ENV.BUILD_VERSION})</p>
    <br/>
    <p>You must <strong><a href="${initLink}"> >>>>> click here <<<<< </a></strong> to bind the webhook.</p>
    <br/>
    ${
      ENV.API_KEY ? '' : buildKeyNotFoundHTML('API_KEY')
}
    <p>After binding the webhook, you can use the following commands to control the bot:</p>
    ${
  commandsDocument().map((item) => `<p><strong>${item.command}</strong> - ${item.description}</p>`).join('')
}
    <br/>
    <p>You can get bot information by visiting the following URL:</p>
    <p><strong>/telegram/:token/bot</strong> - Get bot information</p>
    ${footer}
  `);
  return new Response(HTML, {status: 200, headers: {'Content-Type': 'text/html'}});
}

async function gpt3TokenTest(request) {
  // from query
  const text = new URL(request.url).searchParams.get('text') || 'Hello World';
  const counter = await gpt3TokensCounter();
  const HTML = renderHTML(`
    <h1>ChatGPT-Telegram-Workers</h1>
    <br/>
    <p>Token Counter:</p>
    <p>source text: ${text}</p>
    <p>token count: ${counter((text))}</p>
    <br/>
    `);
  return new Response(HTML, {status: 200, headers: {'Content-Type': 'text/html'}});
}

async function loadBotInfo() {
  const result = [];
  for (const token of ENV.TELEGRAM_AVAILABLE_TOKENS) {
    const id = token.split(':')[0];
    result[id] = await getBot(token);
  }
  const HTML = renderHTML(`
    <h1>ChatGPT-Telegram-Workers</h1>
    <br/>
    <h4>Environment About Bot</h4>
    <p><strong>GROUP_CHAT_BOT_ENABLE:</strong> ${ENV.GROUP_CHAT_BOT_ENABLE}</p>
    <p><strong>GROUP_CHAT_BOT_SHARE_MODE:</strong> ${ENV.GROUP_CHAT_BOT_SHARE_MODE}</p>
    <p><strong>TELEGRAM_BOT_NAME:</strong> ${ENV.TELEGRAM_BOT_NAME.join(',')}</p>
    ${
  Object.keys(result).map((id) => `
            <br/>
            <h4>Bot ID: ${id}</h4>
            <p style="color: ${result[id].ok ? 'green' : 'red'}">${JSON.stringify(result[id])}</p>
            `).join('')
}
    ${footer}
  `);
  return new Response(HTML, {status: 200, headers: {'Content-Type': 'text/html'}});
}

export async function handleRequest(request) {
  const {pathname} = new URL(request.url);
  if (pathname === `/`) {
    return defaultIndexAction();
  }
  if (pathname.startsWith(`/init`)) {
    return bindWebHookAction(request);
  }
  if (pathname.startsWith(`/gpt3/tokens/test`)) {
    return gpt3TokenTest(request);
  }
  if (pathname.startsWith(`/telegram`) && pathname.endsWith(`/history`)) {
    return loadChatHistory(request);
  }
  if (pathname.startsWith(`/telegram`) && pathname.endsWith(`/webhook`)) {
    try {
      const resp = await telegramWebhook(request);
      if (resp.status === 200) {
        return resp;
      } else {
        // 如果返回4xx，5xx，Telegram会重试这个消息，后续消息就不会到达，所有webhook的错误都返回200
        return new Response(resp.body, {status: 200, headers: {
          'Original-Status': resp.status,
          ...resp.headers,
        }});
      }
    } catch (e) {
      console.error(e);
      return new Response(errorToString(e), {status: 200});
    }
  }
  if (pathname.startsWith(`/telegram`) && pathname.endsWith(`/bot`)) {
    return loadBotInfo(request);
  }
  return null;
}
