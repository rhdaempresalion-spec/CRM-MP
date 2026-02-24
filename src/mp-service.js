const axios = require('axios');

/**
 * Gera uma cobrança PIX via API PagamentosMP
 * Otimizado para alta concorrência - cada chamada é 100% isolada
 * 
 * @param {Object} params - Parâmetros da cobrança
 * @param {number} params.valor - Valor em reais (ex: 12.90)
 * @param {string} params.nome - Nome do cliente
 * @param {string} params.email - Email do cliente
 * @param {string} params.telefone - Telefone do cliente
 * @param {string} params.documento - CPF/CNPJ do cliente
 * @param {string} params.referencia - Referência externa única
 * @returns {Object} Resultado da operação
 */
async function gerarPixMP({ valor, nome, email, telefone, documento, referencia }) {
  // Log de entrada para rastreamento
  console.log(`[MP] >>> Gerando PIX: cliente="${nome}" | ref="${referencia}"`);

  const PUBLIC_KEY = process.env.MP_PUBLIC_KEY;
  const SECRET_KEY = process.env.MP_SECRET_KEY;
  const API_URL = process.env.MP_API_URL || 'https://app.pagamentosmp.com/api/v1';
  const EXPIRACAO_DIAS = parseInt(process.env.PIX_EXPIRACAO_DIAS) || 1;

  // Validar credenciais
  if (!PUBLIC_KEY || !SECRET_KEY) {
    return {
      sucesso: false,
      erro: 'Credenciais da API PagamentosMP não configuradas.'
    };
  }

  // === FORMATAR DOCUMENTO ===
  const docLimpo = (documento || '00000000000').replace(/[^0-9]/g, '');
  let docFormatado = docLimpo;
  if (docLimpo.length === 11) {
    docFormatado = docLimpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  } else if (docLimpo.length === 14) {
    docFormatado = docLimpo.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }

  // === FORMATAR TELEFONE ===
  let telLimpo = (telefone || '11999999999').replace(/[^0-9]/g, '');

  // Remover código do país 55 se presente
  if (telLimpo.length === 13 && telLimpo.startsWith('55')) {
    telLimpo = telLimpo.substring(2);
  } else if (telLimpo.length === 12 && telLimpo.startsWith('55')) {
    telLimpo = telLimpo.substring(2);
  }

  // Formatar no padrão (XX) XXXXX-XXXX
  let telFormatado = telLimpo;
  if (telLimpo.length === 11) {
    telFormatado = `(${telLimpo.substring(0, 2)}) ${telLimpo.substring(2, 7)}-${telLimpo.substring(7)}`;
  } else if (telLimpo.length === 10) {
    telFormatado = `(${telLimpo.substring(0, 2)}) ${telLimpo.substring(2, 6)}-${telLimpo.substring(6)}`;
  } else if (telLimpo.length === 9) {
    telFormatado = `(11) ${telLimpo.substring(0, 5)}-${telLimpo.substring(5)}`;
  } else if (telLimpo.length === 8) {
    telFormatado = `(11) ${telLimpo.substring(0, 4)}-${telLimpo.substring(4)}`;
  }

  console.log(`[MP] Tel: ${telefone} -> ${telFormatado} | Doc: ${documento} -> ${docFormatado}`);

  // === MONTAR PAYLOAD ===
  // Identificador 100% único por requisição
  const identifier = `PIX-${referencia}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  // Data de vencimento
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + EXPIRACAO_DIAS);
  const dueDateStr = dueDate.toISOString().split('T')[0];

  // Payload LIMPO - SEM campo products (não é obrigatório e causa erro)
  const payload = {
    identifier: identifier,
    amount: valor,
    client: {
      name: String(nome || 'Cliente'),
      email: String(email || 'cliente@email.com'),
      phone: String(telFormatado),
      document: String(docFormatado)
    },
    dueDate: dueDateStr,
    metadata: {
      referencia: String(referencia),
      tipo: 'PIX_AUTOMATICO'
    }
  };

  console.log(`[MP] Payload: identifier="${identifier}", amount=${valor}, client.name="${payload.client.name}"`);

  // === ENVIAR COM RETRY ===
  const MAX_TENTATIVAS = 3;
  let ultimoErro = null;

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      const response = await axios.post(
        `${API_URL}/gateway/pix/receive`,
        payload,
        {
          headers: {
            'x-public-key': PUBLIC_KEY,
            'x-secret-key': SECRET_KEY,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          timeout: 30000
        }
      );

      const data = response.data;
      console.log(`[MP] Resposta OK (tentativa ${tentativa}): TxID=${data.transactionId}, Status=${data.status}`);

      if (data.pix && data.pix.code) {
        const pixCode = data.pix.code;
        const qrCodeUrl = data.pix.image || `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(pixCode)}`;
        const qrCodeBase64 = data.pix.base64 || null;

        console.log(`[MP] PIX OK para "${nome}" | TxID: ${data.transactionId}`);

        return {
          sucesso: true,
          dados: {
            transactionId: data.transactionId,
            status: data.status,
            pixCopiaCola: pixCode,
            qrcodeUrl: qrCodeUrl,
            qrcodeBase64: qrCodeBase64,
            expirationDate: dueDateStr,
            fee: data.fee || 0,
            externalRef: identifier,
            orderId: data.order ? data.order.id : null,
            orderUrl: data.order ? data.order.url : null
          }
        };
      } else {
        console.error(`[MP] Resposta sem código PIX:`, JSON.stringify(data));
        return {
          sucesso: false,
          erro: 'API PagamentosMP não retornou o código PIX',
          detalhes: data
        };
      }
    } catch (error) {
      let mensagemErro = 'Erro ao conectar com a API PagamentosMP';
      let detalhes = {};
      let podeRetentar = false;

      if (error.response) {
        const status = error.response.status;
        const errorData = error.response.data;

        console.error(`[MP] Erro HTTP ${status} (tentativa ${tentativa}/${MAX_TENTATIVAS}):`, JSON.stringify(errorData));

        if (status === 401) {
          mensagemErro = 'Credenciais de API inválidas.';
          // Não retenta erro de credencial
        } else if (status === 400) {
          mensagemErro = errorData.message || 'Dados inválidos enviados à API.';
          // Não retenta erro de dados inválidos
        } else if (status === 429) {
          // Rate limit - espera e retenta
          mensagemErro = 'Muitas requisições. Aguardando...';
          podeRetentar = true;
        } else if (status >= 500) {
          // Erro do servidor - retenta
          mensagemErro = `Erro do servidor (${status})`;
          podeRetentar = true;
        } else {
          mensagemErro = errorData.message || `Erro HTTP ${status}`;
        }
        detalhes = errorData;
      } else if (error.code === 'ECONNABORTED') {
        mensagemErro = 'Timeout na conexão';
        podeRetentar = true;
      } else if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND') {
        mensagemErro = `Erro de conexão: ${error.code}`;
        podeRetentar = true;
      } else {
        mensagemErro = error.message;
        podeRetentar = true;
      }

      ultimoErro = { erro: mensagemErro, detalhes };

      // Se pode retentar e não é a última tentativa, espera e tenta de novo
      if (podeRetentar && tentativa < MAX_TENTATIVAS) {
        const espera = tentativa * 2000; // 2s, 4s
        console.log(`[MP] Retentando em ${espera}ms... (tentativa ${tentativa + 1}/${MAX_TENTATIVAS})`);
        await new Promise(resolve => setTimeout(resolve, espera));
        continue;
      }

      console.error(`[MP] Erro final para "${nome}":`, mensagemErro);
      return {
        sucesso: false,
        erro: mensagemErro,
        detalhes: detalhes
      };
    }
  }

  // Fallback (não deveria chegar aqui)
  return {
    sucesso: false,
    erro: ultimoErro ? ultimoErro.erro : 'Erro desconhecido',
    detalhes: ultimoErro ? ultimoErro.detalhes : {}
  };
}

module.exports = { gerarPixMP };
