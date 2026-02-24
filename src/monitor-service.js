const axios = require('axios');
const { verificarTransacaoMP } = require('./mp-service');

// ============================================================
// MONITOR DE PAGAMENTOS PIX
// Verifica automaticamente todos os PIX pendentes
// Quando detecta pagamento, envia para o webhook de confirmação
// ============================================================

// Webhook de confirmação de pagamento (diferente do de geração)
const WEBHOOK_PAGAMENTO_CONFIRMADO = 'https://api.datacrazy.io/v1/crm/api/crm/flows/webhooks/a3161e6d-6f4d-4b16-a1b5-16bcb9641994/9d019c08-25ce-4af5-97ab-9acf8dff7751';

// Lista de PIX pendentes sendo monitorados
// Formato: { transactionId, numero_do_lead, pix_copia_cola, qrcode_imagem, valor, criadoEm, tentativas }
const pixPendentes = new Map();

// Intervalo de verificação (em ms) - verifica a cada 15 segundos
const INTERVALO_VERIFICACAO = 15000;

// Máximo de tentativas antes de desistir (24h / 15s = 5760 tentativas)
const MAX_TENTATIVAS = 5760;

let monitorAtivo = false;
let intervaloId = null;

/**
 * Registra um novo PIX para monitoramento
 */
function registrarPixParaMonitorar(dados) {
  const { transactionId, numero_do_lead, pix_copia_cola, qrcode_imagem, qrcode_url, valor, expiracao } = dados;

  pixPendentes.set(transactionId, {
    transactionId,
    numero_do_lead,
    pix_copia_cola,
    qrcode_imagem,
    qrcode_url,
    valor,
    expiracao,
    criadoEm: new Date().toISOString(),
    tentativas: 0
  });

  console.log(`[MONITOR] PIX ${transactionId} registrado para monitoramento | Lead: ${numero_do_lead}`);
  console.log(`[MONITOR] Total de PIX sendo monitorados: ${pixPendentes.size}`);

  // Iniciar monitor se ainda não estiver rodando
  if (!monitorAtivo) {
    iniciarMonitor();
  }
}

/**
 * Inicia o loop de monitoramento
 */
function iniciarMonitor() {
  if (monitorAtivo) return;

  monitorAtivo = true;
  console.log('[MONITOR] Monitor de pagamentos INICIADO');
  console.log(`[MONITOR] Verificando a cada ${INTERVALO_VERIFICACAO / 1000} segundos`);

  intervaloId = setInterval(async () => {
    if (pixPendentes.size === 0) {
      console.log('[MONITOR] Nenhum PIX pendente. Monitor em espera...');
      return;
    }

    console.log(`[MONITOR] Verificando ${pixPendentes.size} PIX pendente(s)...`);

    // Verificar cada PIX pendente
    for (const [transactionId, dados] of pixPendentes) {
      dados.tentativas++;

      // Se excedeu o máximo de tentativas, remover
      if (dados.tentativas > MAX_TENTATIVAS) {
        console.log(`[MONITOR] PIX ${transactionId} expirou (máximo de tentativas). Removendo...`);
        pixPendentes.delete(transactionId);
        continue;
      }

      try {
        const pago = await verificarPagamentoMP(transactionId);

        if (pago) {
          console.log('========================================');
          console.log(`[MONITOR] PAGAMENTO CONFIRMADO! PIX ${transactionId}`);
          console.log(`[MONITOR] Lead: ${dados.numero_do_lead}`);
          console.log('========================================');

          // Enviar confirmação para o webhook do CRM
          await enviarConfirmacaoPagamento(dados);

          // Remover da lista de pendentes
          pixPendentes.delete(transactionId);
          console.log(`[MONITOR] PIX ${transactionId} removido da lista. Restam: ${pixPendentes.size}`);
        } else {
          if (dados.tentativas % 20 === 0) {
            // Log a cada 20 tentativas (~5 min) para não poluir
            console.log(`[MONITOR] PIX ${transactionId} | Lead: ${dados.numero_do_lead} | Tentativa ${dados.tentativas} | Aguardando...`);
          }
        }
      } catch (error) {
        console.error(`[MONITOR] Erro ao verificar PIX ${transactionId}:`, error.message);
      }
    }
  }, INTERVALO_VERIFICACAO);
}

/**
 * Verifica se um pagamento foi efetuado na API PagamentosMP
 * Status COMPLETED = pago
 */
async function verificarPagamentoMP(transactionId) {
  try {
    const data = await verificarTransacaoMP(transactionId);

    // Status "COMPLETED" = pagamento confirmado na PagamentosMP
    return data.status === 'COMPLETED';
  } catch (error) {
    console.error(`[MONITOR] Erro ao consultar transação ${transactionId}:`, error.message);
    return false;
  }
}

/**
 * Envia confirmação de pagamento para o webhook do CRM
 */
async function enviarConfirmacaoPagamento(dados) {
  console.log(`[MONITOR] Enviando confirmação de pagamento para o CRM...`);
  console.log(`[MONITOR] Webhook: ${WEBHOOK_PAGAMENTO_CONFIRMADO}`);
  console.log(`[MONITOR] Lead: ${dados.numero_do_lead}`);

  const payload = {
    evento: 'pagamento_confirmado',
    status: 'pago',
    numero_do_lead: dados.numero_do_lead,
    pix_copia_cola: dados.pix_copia_cola,
    qrcode_imagem: dados.qrcode_imagem,
    qrcode_url: dados.qrcode_url,
    transaction_id: dados.transactionId,
    valor: dados.valor,
    pago_em: new Date().toISOString(),
    gerado_em: dados.criadoEm
  };

  try {
    const response = await axios.post(
      WEBHOOK_PAGAMENTO_CONFIRMADO,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 15000
      }
    );

    console.log(`[MONITOR] Confirmação enviada ao CRM! Status: ${response.status}`);
    console.log(`[MONITOR] Resposta:`, JSON.stringify(response.data));
    return true;
  } catch (error) {
    console.error(`[MONITOR] Erro ao enviar confirmação ao CRM:`, error.message);
    if (error.response) {
      console.error(`[MONITOR] Status:`, error.response.status);
      console.error(`[MONITOR] Dados:`, JSON.stringify(error.response.data));
    }
    return false;
  }
}

/**
 * Retorna status do monitor
 */
function getStatusMonitor() {
  const pendentes = [];
  for (const [id, dados] of pixPendentes) {
    pendentes.push({
      transactionId: id,
      numero_do_lead: dados.numero_do_lead,
      valor: dados.valor,
      criadoEm: dados.criadoEm,
      tentativas: dados.tentativas
    });
  }

  return {
    ativo: monitorAtivo,
    total_pendentes: pixPendentes.size,
    intervalo_segundos: INTERVALO_VERIFICACAO / 1000,
    pendentes: pendentes
  };
}

module.exports = {
  registrarPixParaMonitorar,
  iniciarMonitor,
  getStatusMonitor
};
