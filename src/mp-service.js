const axios = require('axios');

/**
 * Gera uma cobrança PIX via API PagamentosMP
 * 
 * @param {Object} params - Parâmetros da cobrança
 * @param {number} params.valor - Valor em reais (ex: 12.90)
 * @param {string} params.nome - Nome do cliente
 * @param {string} params.email - Email do cliente
 * @param {string} params.telefone - Telefone do cliente
 * @param {string} params.documento - CPF/CNPJ do cliente
 * @param {string} params.referencia - Referência externa
 * @returns {Object} Resultado da operação
 */
async function gerarPixMP({ valor, nome, email, telefone, documento, referencia }) {
  const PUBLIC_KEY = process.env.MP_PUBLIC_KEY;
  const SECRET_KEY = process.env.MP_SECRET_KEY;
  const API_URL = process.env.MP_API_URL || 'https://app.pagamentosmp.com/api/v1';
  const EXPIRACAO_DIAS = parseInt(process.env.PIX_EXPIRACAO_DIAS) || 1;

  // Validar credenciais
  if (!PUBLIC_KEY || !SECRET_KEY) {
    return {
      sucesso: false,
      erro: 'Credenciais da API PagamentosMP não configuradas. Verifique as variáveis de ambiente.'
    };
  }

  // Limpar documento (apenas números)
  const docLimpo = (documento || '00000000000').replace(/[^0-9]/g, '');

  // Formatar documento com pontuação
  let docFormatado = docLimpo;
  if (docLimpo.length === 11) {
    docFormatado = docLimpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  } else if (docLimpo.length === 14) {
    docFormatado = docLimpo.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }

  // Limpar telefone (apenas números)
  let telLimpo = (telefone || '11999999999').replace(/[^0-9]/g, '');

  // Remover código do país 55 se presente
  // Ex: 5511999999999 (13 dígitos) -> 11999999999 (11 dígitos)
  // Ex: 551199999999 (12 dígitos) -> 1199999999 (10 dígitos)
  if (telLimpo.length === 13 && telLimpo.startsWith('55')) {
    telLimpo = telLimpo.substring(2); // Remove o 55 -> fica 11 dígitos
  } else if (telLimpo.length === 12 && telLimpo.startsWith('55')) {
    telLimpo = telLimpo.substring(2); // Remove o 55 -> fica 10 dígitos
  }

  // Formatar telefone no padrão (XX) XXXXX-XXXX ou (XX) XXXX-XXXX
  // A API PagamentosMP exige formato brasileiro: (11) 99999-9999
  let telFormatado = telLimpo;
  if (telLimpo.length === 11) {
    // Celular: (XX) XXXXX-XXXX
    telFormatado = `(${telLimpo.substring(0, 2)}) ${telLimpo.substring(2, 7)}-${telLimpo.substring(7)}`;
  } else if (telLimpo.length === 10) {
    // Fixo: (XX) XXXX-XXXX
    telFormatado = `(${telLimpo.substring(0, 2)}) ${telLimpo.substring(2, 6)}-${telLimpo.substring(6)}`;
  } else if (telLimpo.length === 9) {
    // Só o número sem DDD - assume DDD 11
    telFormatado = `(11) ${telLimpo.substring(0, 5)}-${telLimpo.substring(5)}`;
  } else if (telLimpo.length === 8) {
    // Fixo sem DDD - assume DDD 11
    telFormatado = `(11) ${telLimpo.substring(0, 4)}-${telLimpo.substring(4)}`;
  }

  console.log(`[MP] Telefone original: ${telefone} -> Limpo: ${telLimpo} -> Formatado: ${telFormatado}`);

  // Gerar identificador único
  const identifier = `PIXAUTO-${referencia}-${Date.now()}`;

  // Calcular data de vencimento
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + EXPIRACAO_DIAS);
  const dueDateStr = dueDate.toISOString().split('T')[0]; // YYYY-MM-DD

  // Valor em reais (a API PagamentosMP espera valor em reais, não centavos)
  const valorReais = valor;

  // Montar payload da transação conforme documentação PagamentosMP
  const payload = {
    identifier: identifier,
    amount: valorReais,
    client: {
      name: nome || 'Cliente',
      email: email || 'cliente@email.com',
      phone: telFormatado,
      document: docFormatado
    },
    products: [
      {
        id: `prod-${Date.now()}`,
        name: process.env.PIX_PRODUTO_NOME || 'Pagamento PIX',
        quantity: 1,
        price: valorReais
      }
    ],
    dueDate: dueDateStr,
    metadata: {
      referencia: referencia,
      tipo: 'PIX_AUTOMATICO',
      gerado_em: new Date().toISOString()
    }
  };

  console.log('[MP] Enviando requisição para API PagamentosMP...');
  console.log('[MP] URL:', `${API_URL}/gateway/pix/receive`);
  console.log('[MP] Valor:', `R$ ${valorReais.toFixed(2)}`);
  console.log('[MP] Cliente:', nome);

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
    console.log('[MP] Resposta recebida. Status HTTP:', response.status);
    console.log('[MP] Transaction ID:', data.transactionId);
    console.log('[MP] Status:', data.status);

    // Verificar se o PIX foi gerado com sucesso
    if (data.pix && data.pix.code) {
      const pixCode = data.pix.code;
      // Usar a imagem do QR code retornada pela API, ou gerar via serviço externo
      const qrCodeUrl = data.pix.image || `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(pixCode)}`;
      const qrCodeBase64 = data.pix.base64 || null;

      console.log('[MP] PIX gerado com sucesso!');
      console.log('[MP] Código PIX (primeiros 50 chars):', pixCode.substring(0, 50) + '...');

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
      console.error('[MP] Resposta sem código PIX:', JSON.stringify(data));
      return {
        sucesso: false,
        erro: 'API PagamentosMP não retornou o código PIX',
        detalhes: data
      };
    }
  } catch (error) {
    let mensagemErro = 'Erro ao conectar com a API PagamentosMP';
    let detalhes = {};

    if (error.response) {
      // Erro da API
      const status = error.response.status;
      const errorData = error.response.data;

      console.error('[MP] Erro HTTP:', status);
      console.error('[MP] Resposta:', JSON.stringify(errorData));

      if (status === 401) {
        mensagemErro = 'Credenciais de API inválidas. Verifique suas chaves PagamentosMP.';
      } else if (status === 400) {
        mensagemErro = errorData.message || errorData.error || 'Dados inválidos enviados à API.';
      } else if (status === 422) {
        mensagemErro = errorData.message || 'Dados de validação inválidos.';
      } else {
        mensagemErro = errorData.message || errorData.error || `Erro HTTP ${status}`;
      }
      detalhes = errorData;
    } else if (error.code === 'ECONNABORTED') {
      mensagemErro = 'Timeout ao conectar com a API PagamentosMP';
    } else {
      mensagemErro = error.message;
    }

    console.error('[MP] Erro final:', mensagemErro);

    return {
      sucesso: false,
      erro: mensagemErro,
      detalhes: detalhes
    };
  }
}

module.exports = { gerarPixMP };
