try { require('dotenv').config(); } catch(e) { /* .env não encontrado, usando variáveis de ambiente do sistema */ }
const express = require('express');
const cors = require('cors');
const path = require('path');
const { gerarPixMP, verificarTransacaoMP } = require('./mp-service');
const { enviarParaCRM } = require('./crm-service');
const { registrarPixParaMonitorar, getStatusMonitor } = require('./monitor-service');

// Capturar erros não tratados
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err.message);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection:', reason);
});

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
console.log(`[STARTUP] Iniciando servidor na porta ${PORT}...`);

// ============================================================
// MIDDLEWARES
// ============================================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Log de todas as requisições
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('[BODY]', JSON.stringify(req.body, null, 2));
  }
  next();
});

// ============================================================
// ROTA PRINCIPAL - Health Check
// ============================================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ============================================================
// ROTA: Health Check detalhado
// ============================================================
app.get('/health', (req, res) => {
  const monitor = getStatusMonitor();
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    monitor: monitor,
    env: {
      mp_configured: !!(process.env.MP_PUBLIC_KEY && process.env.MP_SECRET_KEY),
      crm_configured: !!process.env.CRM_WEBHOOK_URL,
      port: PORT
    }
  });
});

// ============================================================
// ROTA: Status do monitor de pagamentos
// ============================================================
app.get('/api/monitor', (req, res) => {
  const monitor = getStatusMonitor();
  res.json({
    sucesso: true,
    monitor: monitor
  });
});

// ============================================================
// ROTA: Receber webhook do CRM e gerar PIX automaticamente
// Esta é a rota principal que o CRM vai chamar
// ============================================================
app.post('/webhook', async (req, res) => {
  console.log('========================================');
  console.log('[WEBHOOK RECEBIDO] Dados do CRM:');
  console.log(JSON.stringify(req.body, null, 2));
  console.log('========================================');

  try {
    const dados = req.body;

    const nome = dados.nome || dados.name || dados.customer_name || dados.contact_name || 'Cliente';
    const email = dados.email || dados.customer_email || dados.contact_email || 'cliente@email.com';
    const telefone = dados.telefone || dados.phone || dados.customer_phone || dados.contact_phone || '11999999999';
    const documento = dados.documento || dados.cpf || dados.document || dados.customer_document || '00000000000';
    const referencia = dados.referencia || dados.reference || dados.id || dados.lead_id || `CRM-${Date.now()}`;
    const numero_do_lead = dados.numero_do_lead || dados.telefone || dados.phone || '';

    // Valor em reais (PagamentosMP usa reais, não centavos)
    const valorReais = parseFloat(process.env.PIX_VALOR) || 12.90;

    console.log(`[PIX] Gerando PIX de R$ ${valorReais.toFixed(2)} para ${nome}`);

    const resultadoPix = await gerarPixMP({
      valor: valorReais,
      nome,
      email,
      telefone,
      documento,
      referencia
    });

    if (resultadoPix.sucesso) {
      console.log('[PIX] PIX gerado com sucesso!');
      console.log('[PIX] Código copia e cola:', resultadoPix.dados.pixCopiaCola);
      console.log('[PIX] Transaction ID:', resultadoPix.dados.transactionId);

      // Usar QR code da API ou gerar externamente
      const qrcodeImagem = resultadoPix.dados.qrcodeUrl || `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(resultadoPix.dados.pixCopiaCola)}`;

      // Enviar o código PIX de volta para o CRM via webhook
      const dadosCRM = {
        sucesso: true,
        numero_do_lead: numero_do_lead,
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
        referencia: referencia,
        cliente_nome: nome,
        cliente_email: email,
        gerado_em: new Date().toISOString()
      };

      // Enviar para o webhook do CRM
      try {
        await enviarParaCRM(dadosCRM);
        console.log('[CRM] Dados enviados para o CRM com sucesso!');
      } catch (crmError) {
        console.error('[CRM] Erro ao enviar para CRM:', crmError.message);
      }

      // ============================================================
      // REGISTRAR PIX PARA MONITORAMENTO AUTOMÁTICO
      // O monitor vai ficar verificando se foi pago
      // Quando pagar, envia para o webhook de confirmação
      // ============================================================
      registrarPixParaMonitorar({
        transactionId: resultadoPix.dados.transactionId,
        numero_do_lead: numero_do_lead,
        pix_copia_cola: resultadoPix.dados.pixCopiaCola,
        qrcode_imagem: qrcodeImagem,
        qrcode_url: resultadoPix.dados.qrcodeUrl,
        valor: `R$ ${valorReais.toFixed(2)}`,
        expiracao: resultadoPix.dados.expirationDate
      });

      // Retornar resposta com o PIX
      return res.status(200).json({
        sucesso: true,
        mensagem: 'PIX gerado com sucesso',
        numero_do_lead: numero_do_lead,
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
      });
    } else {
      console.error('[PIX] Erro ao gerar PIX:', resultadoPix.erro);
      return res.status(400).json({
        sucesso: false,
        erro: resultadoPix.erro,
        detalhes: resultadoPix.detalhes
      });
    }
  } catch (error) {
    console.error('[ERRO GERAL]', error.message);
    return res.status(500).json({
      sucesso: false,
      erro: 'Erro interno ao processar webhook',
      detalhes: error.message
    });
  }
});

// ============================================================
// ROTA: Gerar PIX via API (chamada direta)
// ============================================================
app.post('/api/gerar-pix', async (req, res) => {
  console.log('[API] Requisição para gerar PIX recebida');

  try {
    const dados = req.body;

    const nome = dados.nome || dados.name || 'Cliente';
    const email = dados.email || 'cliente@email.com';
    const telefone = dados.telefone || dados.phone || '11999999999';
    const documento = dados.documento || dados.cpf || '00000000000';
    const referencia = dados.referencia || dados.reference || `API-${Date.now()}`;
    const numero_do_lead = dados.numero_do_lead || dados.telefone || dados.phone || '';

    // Valor em reais
    const valorReais = parseFloat(process.env.PIX_VALOR) || 12.90;

    const resultadoPix = await gerarPixMP({
      valor: valorReais,
      nome,
      email,
      telefone,
      documento,
      referencia
    });

    if (resultadoPix.sucesso) {
      const qrcodeImagem = resultadoPix.dados.qrcodeUrl || `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(resultadoPix.dados.pixCopiaCola)}`;

      // Envia para o CRM automaticamente
      const dadosCRM = {
        sucesso: true,
        numero_do_lead: numero_do_lead,
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
        referencia: referencia,
        cliente_nome: nome,
        cliente_email: email,
        gerado_em: new Date().toISOString()
      };

      try {
        await enviarParaCRM(dadosCRM);
        console.log('[CRM] Dados enviados para o CRM com sucesso!');
      } catch (crmError) {
        console.error('[CRM] Erro ao enviar para CRM:', crmError.message);
      }

      // Registrar para monitoramento automático
      registrarPixParaMonitorar({
        transactionId: resultadoPix.dados.transactionId,
        numero_do_lead: numero_do_lead,
        pix_copia_cola: resultadoPix.dados.pixCopiaCola,
        qrcode_imagem: qrcodeImagem,
        qrcode_url: resultadoPix.dados.qrcodeUrl,
        valor: `R$ ${valorReais.toFixed(2)}`,
        expiracao: resultadoPix.dados.expirationDate
      });

      return res.status(200).json({
        sucesso: true,
        mensagem: 'PIX gerado com sucesso',
        numero_do_lead: numero_do_lead,
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
      });
    } else {
      return res.status(400).json({
        sucesso: false,
        erro: resultadoPix.erro,
        detalhes: resultadoPix.detalhes
      });
    }
  } catch (error) {
    console.error('[ERRO]', error.message);
    return res.status(500).json({
      sucesso: false,
      erro: 'Erro interno ao gerar PIX',
      detalhes: error.message
    });
  }
});

// ============================================================
// ROTA: Verificar status de uma transação
// ============================================================
app.get('/api/status/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;

    const data = await verificarTransacaoMP(transactionId);

    // Mapear status da PagamentosMP
    let statusMapeado = data.status;
    const pago = data.status === 'COMPLETED';

    return res.json({
      sucesso: true,
      transactionId: transactionId,
      status: statusMapeado,
      statusOriginal: data.status,
      pago: pago,
      dados: data
    });
  } catch (error) {
    console.error('[STATUS] Erro:', error.message);
    return res.status(500).json({
      sucesso: false,
      erro: 'Erro ao verificar status',
      detalhes: error.message
    });
  }
});

// ============================================================
// ROTA: Webhook de notificação de pagamento (callback da PagamentosMP)
// ============================================================
app.post('/webhook/mp-callback', async (req, res) => {
  console.log('========================================');
  console.log('[MP CALLBACK] Notificação de pagamento:');
  console.log(JSON.stringify(req.body, null, 2));
  console.log('========================================');

  try {
    const dados = req.body;

    // PagamentosMP envia evento TRANSACTION_PAID com status COMPLETED
    if (dados.event === 'TRANSACTION_PAID' || 
        (dados.transaction && dados.transaction.status === 'COMPLETED')) {
      const transactionId = dados.transaction ? dados.transaction.id : (dados.id || dados.transactionId);
      const valor = dados.transaction ? dados.transaction.amount : dados.amount;

      const dadosCRM = {
        evento: 'pagamento_confirmado',
        transaction_id: transactionId,
        status: 'COMPLETED',
        valor: valor,
        pago_em: dados.transaction ? dados.transaction.payedAt : new Date().toISOString()
      };

      try {
        await enviarParaCRM(dadosCRM);
        console.log('[CRM] Notificação de pagamento enviada ao CRM');
      } catch (crmError) {
        console.error('[CRM] Erro ao notificar CRM:', crmError.message);
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('[CALLBACK ERRO]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Manter compatibilidade com a rota antiga do DHR postback
app.post('/webhook/dhr-postback', async (req, res) => {
  console.log('[LEGACY] Redirecionando dhr-postback para mp-callback');
  // Redirecionar para o novo handler
  req.url = '/webhook/mp-callback';
  app.handle(req, res);
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log('============================================');
  console.log(`  PIX Webhook Backend v3.0.0 (PagamentosMP)`);
  console.log(`  Servidor rodando na porta ${PORT}`);
  console.log(`  Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  API: ${process.env.MP_API_URL || 'https://app.pagamentosmp.com/api/v1'}`);
  console.log(`  Valor PIX: R$ ${(parseFloat(process.env.PIX_VALOR) || 12.90).toFixed(2)}`);
  console.log('============================================');
  console.log('Endpoints disponíveis:');
  console.log(`  GET  /                    - Página de demonstração`);
  console.log(`  GET  /health              - Status detalhado + monitor`);
  console.log(`  POST /webhook             - Receber webhook do CRM`);
  console.log(`  POST /api/gerar-pix       - Gerar PIX via API`);
  console.log(`  GET  /api/status/:id      - Verificar pagamento`);
  console.log(`  GET  /api/monitor         - Status do monitor de pagamentos`);
  console.log(`  POST /webhook/mp-callback - Callback PagamentosMP`);
  console.log('============================================');
  console.log('[MONITOR] Sistema de monitoramento de pagamentos ATIVO');
  console.log('[MONITOR] Verificação a cada 15 segundos');
  console.log('[MONITOR] Ao confirmar pagamento, envia para webhook de confirmação');
  console.log('============================================');
});
