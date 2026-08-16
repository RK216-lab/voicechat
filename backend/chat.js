export const config = { runtime: 'edge' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json',...corsHeaders },
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
  // 修正#1 OPTIONS対応
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method!== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const messages = body.messages;
  // 修正#5 バリデーション
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonResponse({ error: 'messages is required' }, 400);
  }

  const apiKey = process.env.GROQ_API_KEY;
  const stream = body.stream === true;
  // 修正#6 コスト対策でクランプ
  const maxTokens = Math.min(Math.max(parseInt(body.max_tokens || 120, 10) || 120, 20), 200);

  // 修正#3 APIキー無しでも会話を止めない
  if (!apiKey) {
    console.warn('[Chat] GROQ_API_KEY missing, using fallback');
    return jsonResponse({ text: getFallbackText(messages), fallback: true });
  }

  const payload = {
    model: 'openai/gpt-oss-20b',
    messages,
    reasoning_effort: 'low',
    temperature: 0.75,
    max_completion_tokens: maxTokens,
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
      console.error(`[Groq error] ${response.status} ${errText}`);
      // 修正#4 エラーでも200でフォールバックテキストを返して会話継続
      return jsonResponse({
        text: getFallbackText(messages),
        fallback: true,
        groq_error: errText,
      });
    }

    if (stream) {
      // ストリーミングはそのままパススルー
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
    // 修正#4 絶対に会話を止めない
    return jsonResponse({
      text: getFallbackText(messages),
      fallback: true,
      error: error.message,
    });
  }
}