try { require('dotenv').config(); } catch(e) { /* sem .env */ }
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { gerarPixMP } = require('./mp-service');
const { enviarParaCRM } = require('./crm-service');

// Capturar erros não tratados
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled Rejection:', reason);
});

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;

// ============================================================
// FILA DE PROCESSAMENTO - Garante isolamento total entre leads
// Processa requisições em paralelo mas com limite de concorrência
// ============================================================
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT) || 10;
let activeRequests = 0;
let totalProcessed = 0;
let totalErrors = 0;

// ============================================================
// MIDDLEWARES
// ============================================================
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ID único por requisição + log
app.use((req, res, next) => {
  req.requestId = crypto.randomBytes(4).toString('hex');
  req.startTime = Date.now();
  const ts = new Date().toISOString();
  console.log(`[${ts}] [REQ:${req.requestId}] ${req.method} ${req.path} (ativas: ${activeRequests})`);
  next();
});

// ============================================================
// ROTA: Página
// ============================================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ============================================================
// ROTA: Health Check (com métricas)
// ============================================================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    metrics: {
      active_requests: activeRequests,
      total_processed: totalProcessed,
      total_errors: totalErrors,
      max_concurrent: MAX_CONCURRENT
    },
    env: {
      mp_configured: !!(process.env.MP_PUBLIC_KEY && process.env.MP_SECRET_KEY),
      crm_configured: !!process.env.CRM_WEBHOOK_URL,
      port: PORT
    }
  });
});

// ============================================================
// FUNÇÃO: Processar geração de PIX (isolada por requisição)
// ============================================================
async function processarPixParaLead(rid, body) {
  // Extrair dados - tudo const e local, 100% isolado
  const nome = body.nome || body.name || body.customer_name || body.contact_name || 'Cliente';
  const email = body.email || body.customer_email || body.contact_email || 'cliente@email.com';
  const telefone = body.telefone || body.phone || body.customer_phone || body.contact_phone || '11999999999';
  const documento = body.documento || body.cpf || body.document || body.customer_document || '00000000000';
  const numero_do_lead = body.numero_do_lead || body.telefone || body.phone || '';

  // Referência 100% única
  const referencia = `${rid}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const valorReais = parseFloat(process.env.PIX_VALOR) || 12.90;

  console.log(`[REQ:${rid}] Lead: "${nome}" | Tel: "${telefone}" | Doc: "${documento}" | Num: "${numero_do_lead}"`);

  // Gerar PIX NOVO
  const resultadoPix = await gerarPixMP({
    valor: valorReais,
    nome,
    email,
    telefone,
    documento,
    referencia
  });

  if (!resultadoPix.sucesso) {
    return { sucesso: false, erro: resultadoPix.erro, detalhes: resultadoPix.detalhes };
  }

  console.log(`[REQ:${rid}] PIX OK: "${nome}" -> TxID: ${resultadoPix.dados.transactionId}`);

  const qrcodeImagem = resultadoPix.dados.qrcodeUrl || 
    `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(resultadoPix.dados.pixCopiaCola)}`;

  // Montar dados CRM
  const dadosCRM = {
    sucesso: true,
    numero_do_lead,
    pix_copia_cola: resultadoPix.dados.pixCopiaCola,
    pix_qrcode: resultadoPix.dados.pixCopiaCola,
    qrcode_imagem: qrcodeImagem,
    qrcode_url: resultadoPix.dados.qrcodeUrl,
    qrcode_base64: resultadoPix.dados.qrcodeBase64 || null,
    transaction_id: resultadoPix.dados.transactionId,
    status: resultadoPix.dados.status,
    valor: `R$ ${valorReais.toFixed(2)}`,
    valor_reais: valorReais,
    expiracao: resultadoPix.dados.expirationDate,
    referencia,
    cliente_nome: nome,
    cliente_email: email,
    gerado_em: new Date().toISOString()
  };

  // Enviar para CRM em background (NÃO bloqueia a resposta ao lead)
  enviarParaCRM(dadosCRM)
    .then(() => console.log(`[REQ:${rid}] CRM OK para "${nome}"`))
    .catch(err => console.error(`[REQ:${rid}] CRM ERRO para "${nome}":`, err.message));

  return {
    sucesso: true,
    request_id: rid,
    numero_do_lead,
    cliente_nome: nome,
    pix: {
      copia_cola: resultadoPix.dados.pixCopiaCola,
      qrcode_imagem: qrcodeImagem,
      qrcode_url: resultadoPix.dados.qrcodeUrl,
      qrcode_base64: resultadoPix.dados.qrcodeBase64 || null,
      transaction_id: resultadoPix.dados.transactionId,
      status: resultadoPix.dados.status,
      valor: `R$ ${valorReais.toFixed(2)}`,
      expiracao: resultadoPix.dados.expirationDate
    }
  };
}

// ============================================================
// ROTA: Webhook do CRM - Gerar PIX NOVO para cada lead
// ============================================================
app.post('/webhook', async (req, res) => {
  const rid = req.requestId;

  // Controle de concorrência
  if (activeRequests >= MAX_CONCURRENT) {
    console.warn(`[REQ:${rid}] FILA CHEIA (${activeRequests}/${MAX_CONCURRENT}). Aguardando...`);
    // Espera até 10s por uma vaga
    const esperaMax = 10000;
    const inicio = Date.now();
    while (activeRequests >= MAX_CONCURRENT && (Date.now() - inicio) < esperaMax) {
      await new Promise(r => setTimeout(r, 200));
    }
    if (activeRequests >= MAX_CONCURRENT) {
      totalErrors++;
      return res.status(503).json({
        sucesso: false,
        request_id: rid,
        erro: 'Servidor sobrecarregado. Tente novamente em alguns segundos.'
      });
    }
  }

  activeRequests++;
  console.log(`[REQ:${rid}] WEBHOOK: "${req.body?.nome || '?'}" (ativas: ${activeRequests}/${MAX_CONCURRENT})`);

  try {
    const resultado = await processarPixParaLead(rid, req.body);
    totalProcessed++;

    if (resultado.sucesso) {
      const tempo = Date.now() - req.startTime;
      console.log(`[REQ:${rid}] COMPLETO em ${tempo}ms: "${resultado.cliente_nome}"`);
      return res.status(200).json({ sucesso: true, mensagem: 'PIX gerado com sucesso', ...resultado });
    } else {
      totalErrors++;
      return res.status(400).json({ sucesso: false, request_id: rid, ...resultado });
    }
  } catch (error) {
    totalErrors++;
    console.error(`[REQ:${rid}] ERRO GERAL:`, error.message);
    return res.status(500).json({
      sucesso: false,
      request_id: rid,
      erro: 'Erro interno ao processar webhook',
      detalhes: error.message
    });
  } finally {
    activeRequests--;
  }
});

// ============================================================
// ROTA: Gerar PIX via API direta
// ============================================================
app.post('/api/gerar-pix', async (req, res) => {
  const rid = req.requestId;

  if (activeRequests >= MAX_CONCURRENT) {
    return res.status(503).json({
      sucesso: false,
      request_id: rid,
      erro: 'Servidor sobrecarregado. Tente novamente.'
    });
  }

  activeRequests++;

  try {
    const resultado = await processarPixParaLead(rid, req.body);
    totalProcessed++;

    if (resultado.sucesso) {
      return res.status(200).json({ sucesso: true, mensagem: 'PIX gerado com sucesso', ...resultado });
    } else {
      totalErrors++;
      return res.status(400).json({ sucesso: false, request_id: rid, ...resultado });
    }
  } catch (error) {
    totalErrors++;
    console.error(`[REQ:${rid}] ERRO:`, error.message);
    return res.status(500).json({
      sucesso: false,
      request_id: rid,
      erro: 'Erro interno',
      detalhes: error.message
    });
  } finally {
    activeRequests--;
  }
});

// ============================================================
// ROTA: Callback PagamentosMP
// ============================================================
app.post('/webhook/mp-callback', async (req, res) => {
  const rid = req.requestId;
  console.log(`[REQ:${rid}] MP CALLBACK:`, JSON.stringify(req.body, null, 2));

  try {
    const dados = req.body;

    if (dados.event === 'TRANSACTION_PAID' || 
        (dados.transaction && dados.transaction.status === 'COMPLETED')) {
      const transactionId = dados.transaction ? dados.transaction.id : (dados.id || dados.transactionId);
      const valor = dados.transaction ? dados.transaction.amount : dados.amount;

      // Enviar em background
      enviarParaCRM({
        evento: 'pagamento_confirmado',
        transaction_id: transactionId,
        status: 'COMPLETED',
        valor,
        pago_em: dados.transaction ? dados.transaction.payedAt : new Date().toISOString()
      })
        .then(() => console.log(`[REQ:${rid}] Pagamento confirmado enviado ao CRM`))
        .catch(err => console.error(`[REQ:${rid}] Erro CRM callback:`, err.message));
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error(`[REQ:${rid}] CALLBACK ERRO:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log('============================================');
  console.log(`  PIX Webhook v5.0.0 (PagamentosMP)`);
  console.log(`  Porta: ${PORT}`);
  console.log(`  Concorrência máx: ${MAX_CONCURRENT}`);
  console.log(`  Valor PIX: R$ ${(parseFloat(process.env.PIX_VALOR) || 12.90).toFixed(2)}`);
  console.log(`  API: ${process.env.MP_API_URL || 'https://app.pagamentosmp.com/api/v1'}`);
  console.log('============================================');
  console.log('  POST /webhook             - PIX via CRM');
  console.log('  POST /api/gerar-pix       - PIX via API');
  console.log('  POST /webhook/mp-callback - Callback MP');
  console.log('  GET  /health              - Status + métricas');
  console.log('============================================');
  console.log('[OK] Servidor pronto para receber requisições');
  console.log('[OK] Cada lead gera PIX NOVO e isolado');
  console.log('[OK] Sem products no payload (corrige erro 400)');
  console.log('[OK] Retry automático em erros de rede/servidor');
  console.log('[OK] CRM notificado em background (não bloqueia)');
  console.log('============================================');
});
