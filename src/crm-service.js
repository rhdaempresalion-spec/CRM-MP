const axios = require('axios');

/**
 * Envia dados para o webhook do CRM DataCrazy
 * 
 * @param {Object} dados - Dados a serem enviados ao CRM
 * @returns {Object} Resposta do CRM
 */
async function enviarParaCRM(dados) {
  const CRM_WEBHOOK_URL = process.env.CRM_WEBHOOK_URL;

  if (!CRM_WEBHOOK_URL) {
    console.warn('[CRM] URL do webhook do CRM não configurada. Pulando envio.');
    return { sucesso: false, erro: 'URL do webhook não configurada' };
  }

  console.log('[CRM] Enviando dados para o webhook do CRM...');
  console.log('[CRM] URL:', CRM_WEBHOOK_URL);

  try {
    const response = await axios.post(
      CRM_WEBHOOK_URL,
      dados,
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 15000
      }
    );

    console.log('[CRM] Resposta do CRM - Status:', response.status);
    console.log('[CRM] Dados da resposta:', JSON.stringify(response.data));

    return {
      sucesso: true,
      status: response.status,
      dados: response.data
    };
  } catch (error) {
    let mensagemErro = 'Erro ao enviar para o CRM';

    if (error.response) {
      console.error('[CRM] Erro HTTP:', error.response.status);
      console.error('[CRM] Resposta:', JSON.stringify(error.response.data));
      mensagemErro = `Erro HTTP ${error.response.status} do CRM`;
    } else if (error.code === 'ECONNABORTED') {
      mensagemErro = 'Timeout ao conectar com o CRM';
    } else {
      mensagemErro = error.message;
    }

    console.error('[CRM] Erro:', mensagemErro);

    // Não lança erro para não interromper o fluxo principal
    return {
      sucesso: false,
      erro: mensagemErro
    };
  }
}

module.exports = { enviarParaCRM };
