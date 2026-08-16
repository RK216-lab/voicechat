export const config = { runtime: 'edge' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function getFallbackText(messages) {
  const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  const userCount = messages.filter(m => m.role === 'user').length;
  if (userCount <= 1) {
    if (/疲|だる|眠|しんど/.test(lastUser)) return 'そっか、疲れを感じてるんだね。どんな時に一番つらいと感じる？';
    if (/元気|大丈夫/.test(lastUser)) return '元気そうでよかった。今日はどんなことがあったのか教えてくれる？';
    return 'そうなんだね。もう少しだけ詳しく聞かせてくれる？';
  }
  return '話してくれてありがとう。少しゆっくり休んでみてもいいかもね。';
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  let body;
  try { body = await req.json(); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonResponse({ error: 'messages is required' }, 400);
  }

  const apiKey = process.env.GROQ_API_KEY;
  const stream = body.stream === true;
  // ★gpt-ossは推論トークンを食うので300-800にクランプ。200以下だと空文字になる
  const requested = parseInt(body.max_tokens || body.max_completion_tokens || 400, 10) || 400;
  const maxCompletion = Math.min(Math.max(requested, 300), 800);

  if (!apiKey) {
    console.warn('[Chat] GROQ_API_KEY missing on Vercel');
    return jsonResponse({ text: getFallbackText(messages), fallback: true });
  }

  // ★GPT-OSS-20B固定 最軽量設定
  const payload = {
    model: 'openai/gpt-oss-20b',
    messages,
    reasoning_effort: 'low', // 最軽量推論
    temperature: 0.75,
    max_completion_tokens: maxCompletion,
    stream,
  };

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[Groq gpt-oss error] ${response.status} ${errText}`);
      return jsonResponse({
        text: getFallbackText(messages),
        fallback: true,
        groq_error: errText.slice(0, 800),
      });
    }

    if (stream) {
      return new Response(response.body, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-store',
          Connection: 'keep-alive',
          ...corsHeaders,
        },
      });
    }

    const data = await response.json();
    const textOut = data.choices?.[0]?.message?.content || getFallbackText(messages);
    return jsonResponse({ text: textOut });
  } catch (error) {
    console.error('[Chat handler error]', error);
    return jsonResponse({ text: getFallbackText(messages), fallback: true, error: error.message });
  }
}
