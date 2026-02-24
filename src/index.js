try { require('dotenv').config(); } catch(e) { /* .env não encontrado, usando variáveis de ambiente do sistema */ }
const express = require('express');
const cors = require('cors');
const path = require('path');
const { gerarPixMP } = require('./mp-service');
const { enviarParaCRM } = require('./crm-service');

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
// ROTA PRINCIPAL - Página de demonstração
// ============================================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ============================================================
// ROTA: Health Check
// ============================================================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    env: {
      mp_configured: !!(process.env.MP_PUBLIC_KEY && process.env.MP_SECRET_KEY),
      crm_configured: !!process.env.CRM_WEBHOOK_URL,
      port: PORT
    }
  });
});

// ============================================================
// ROTA: Receber webhook do CRM e gerar PIX NOVO automaticamente
// Cada requisição SEMPRE gera um PIX novo e único para o lead
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
    const numero_do_lead = dados.numero_do_lead || dados.telefone || dados.phone || '';

    // Referência única para cada PIX gerado (garante que nunca reutiliza)
    const referencia = `CRM-${numero_do_lead}-${Date.now()}`;

    // Valor em reais (PagamentosMP usa reais, não centavos)
    const valorReais = parseFloat(process.env.PIX_VALOR) || 12.90;

    console.log(`[PIX] Gerando PIX NOVO de R$ ${valorReais.toFixed(2)} para ${nome} (Lead: ${numero_do_lead})`);

    // SEMPRE gera um PIX novo na API PagamentosMP
    const resultadoPix = await gerarPixMP({
      valor: valorReais,
      nome,
      email,
      telefone,
      documento,
      referencia
    });

    if (resultadoPix.sucesso) {
      console.log('[PIX] PIX NOVO gerado com sucesso!');
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
        console.log('[CRM] Dados do PIX NOVO enviados para o CRM com sucesso!');
      } catch (crmError) {
        console.error('[CRM] Erro ao enviar para CRM:', crmError.message);
      }

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
// Também SEMPRE gera um PIX novo
// ============================================================
app.post('/api/gerar-pix', async (req, res) => {
  console.log('[API] Requisição para gerar PIX NOVO recebida');

  try {
    const dados = req.body;

    const nome = dados.nome || dados.name || 'Cliente';
    const email = dados.email || 'cliente@email.com';
    const telefone = dados.telefone || dados.phone || '11999999999';
    const documento = dados.documento || dados.cpf || '00000000000';
    const numero_do_lead = dados.numero_do_lead || dados.telefone || dados.phone || '';

    // Referência única
    const referencia = `API-${numero_do_lead}-${Date.now()}`;

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
        console.log('[CRM] Dados do PIX NOVO enviados para o CRM com sucesso!');
      } catch (crmError) {
        console.error('[CRM] Erro ao enviar para CRM:', crmError.message);
      }

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
// ROTA: Callback da PagamentosMP (notificação de pagamento)
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

// ============================================================
// INICIAR SERVIDOR
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log('============================================');
  console.log(`  PIX Webhook Backend v4.0.0 (PagamentosMP)`);
  console.log(`  Servidor rodando na porta ${PORT}`);
  console.log(`  Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  API: ${process.env.MP_API_URL || 'https://app.pagamentosmp.com/api/v1'}`);
  console.log(`  Valor PIX: R$ ${(parseFloat(process.env.PIX_VALOR) || 12.90).toFixed(2)}`);
  console.log('============================================');
  console.log('Endpoints disponíveis:');
  console.log(`  GET  /                    - Página de demonstração`);
  console.log(`  GET  /health              - Status do servidor`);
  console.log(`  POST /webhook             - Receber webhook do CRM e gerar PIX NOVO`);
  console.log(`  POST /api/gerar-pix       - Gerar PIX NOVO via API`);
  console.log(`  POST /webhook/mp-callback - Callback PagamentosMP`);
  console.log('============================================');
  console.log('[INFO] Cada requisição SEMPRE gera um PIX novo e único');
  console.log('[INFO] Sem cache, sem monitoramento, sem reutilização');
  console.log('============================================');
});
