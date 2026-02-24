/**
 * ============================================================
 * SCRIPT DE INTEGRAÇÃO - Gerador de PIX via PagamentosMP
 * ============================================================
 * 
 * Este script deve ser incluído na sua página/automação.
 * Quando o usuário clicar em "Gerar PIX", ele envia uma
 * requisição para o webhook que gera o PIX automaticamente
 * e retorna o código copia e cola.
 * 
 * COMO USAR:
 * 1. Inclua este script na sua página HTML
 * 2. Configure a URL_BACKEND com a URL do seu servidor (Railway)
 * 3. Chame a função gerarPix() quando quiser gerar um PIX
 * 
 * ============================================================
 */

// ============================================================
// CONFIGURAÇÃO - Altere a URL para o seu servidor no Railway
// ============================================================
const CONFIG = {
  // URL do seu backend hospedado no Railway
  // Altere para a URL real após o deploy
  URL_BACKEND: window.PIX_BACKEND_URL || 'https://seu-app.up.railway.app',
  
  // Webhook do CRM DataCrazy (usado como fallback direto)
  WEBHOOK_CRM: 'https://api.datacrazy.io/v1/crm/api/crm/flows/webhooks/a3161e6d-6f4d-4b16-a1b5-16bcb9641994/f60b9be2-97e9-41c1-b618-d98b67174ec7',
  
  // Intervalo de verificação de pagamento (ms)
  INTERVALO_VERIFICACAO: 5000,
  
  // Tempo máximo de verificação (ms) - 30 minutos
  TIMEOUT_VERIFICACAO: 1800000
};

// ============================================================
// FUNÇÃO PRINCIPAL: Gerar PIX
// ============================================================

/**
 * Gera um PIX enviando requisição ao webhook
 * 
 * @param {Object} dadosCliente - Dados do cliente (opcional)
 * @param {string} dadosCliente.nome - Nome do cliente
 * @param {string} dadosCliente.email - Email do cliente
 * @param {string} dadosCliente.telefone - Telefone do cliente
 * @param {string} dadosCliente.documento - CPF/CNPJ do cliente
 * @returns {Promise<Object>} Resultado com o código PIX
 */
async function gerarPix(dadosCliente = {}) {
  console.log('[PIX] Iniciando geração de PIX via PagamentosMP...');
  
  // Montar payload
  const payload = {
    nome: dadosCliente.nome || 'Cliente',
    email: dadosCliente.email || 'cliente@email.com',
    telefone: dadosCliente.telefone || '11999999999',
    documento: dadosCliente.documento || dadosCliente.cpf || '00000000000',
    referencia: dadosCliente.referencia || `WEB-${Date.now()}`,
    origem: 'javascript_integracao',
    timestamp: new Date().toISOString()
  };

  try {
    // Enviar para o backend (recomendado)
    // O backend gera o PIX via PagamentosMP e envia para o CRM automaticamente
    const response = await fetch(`${CONFIG.URL_BACKEND}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const resultado = await response.json();

    if (resultado.sucesso && resultado.pix) {
      console.log('[PIX] PIX gerado com sucesso!');
      console.log('[PIX] Código copia e cola:', resultado.pix.copia_cola);
      
      return {
        sucesso: true,
        pixCopiaCola: resultado.pix.copia_cola,
        qrcodeUrl: resultado.pix.qrcode_url,
        qrcodeBase64: resultado.pix.qrcode_base64 || null,
        transactionId: resultado.pix.transaction_id,
        valor: resultado.pix.valor,
        expiracao: resultado.pix.expiracao
      };
    } else {
      console.error('[PIX] Erro na resposta:', resultado.erro);
      return {
        sucesso: false,
        erro: resultado.erro || 'Erro ao gerar PIX'
      };
    }
  } catch (error) {
    console.error('[PIX] Erro na requisição:', error.message);
    
    // Fallback - enviar direto para o webhook do CRM
    console.log('[PIX] Tentando fallback via webhook CRM...');
    try {
      const fallbackResponse = await fetch(CONFIG.WEBHOOK_CRM, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...payload,
          acao: 'gerar_pix',
          fallback: true
        })
      });

      const fallbackResult = await fallbackResponse.json();
      return {
        sucesso: true,
        dados: fallbackResult,
        via: 'fallback_crm'
      };
    } catch (fallbackError) {
      return {
        sucesso: false,
        erro: 'Não foi possível gerar o PIX. Tente novamente.',
        detalhes: error.message
      };
    }
  }
}

// ============================================================
// FUNÇÃO: Gerar PIX via API direta do backend
// ============================================================
async function gerarPixViaAPI(dadosCliente = {}) {
  console.log('[PIX API] Gerando PIX via endpoint /api/gerar-pix...');
  
  const payload = {
    nome: dadosCliente.nome || 'Cliente',
    email: dadosCliente.email || 'cliente@email.com',
    telefone: dadosCliente.telefone || '11999999999',
    documento: dadosCliente.documento || '00000000000',
    referencia: dadosCliente.referencia || `API-${Date.now()}`
  };

  try {
    const response = await fetch(`${CONFIG.URL_BACKEND}/api/gerar-pix`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const resultado = await response.json();

    if (resultado.sucesso && resultado.pix) {
      return {
        sucesso: true,
        pixCopiaCola: resultado.pix.copia_cola,
        qrcodeUrl: resultado.pix.qrcode_url,
        qrcodeBase64: resultado.pix.qrcode_base64 || null,
        transactionId: resultado.pix.transaction_id,
        valor: resultado.pix.valor,
        expiracao: resultado.pix.expiracao
      };
    } else {
      return {
        sucesso: false,
        erro: resultado.erro || 'Erro ao gerar PIX'
      };
    }
  } catch (error) {
    return {
      sucesso: false,
      erro: error.message
    };
  }
}

// ============================================================
// FUNÇÃO: Verificar status do pagamento
// ============================================================
async function verificarPagamento(transactionId) {
  try {
    const response = await fetch(`${CONFIG.URL_BACKEND}/api/status/${transactionId}`);
    const resultado = await response.json();
    
    return {
      sucesso: true,
      pago: resultado.pago || false,
      status: resultado.status,
      dados: resultado
    };
  } catch (error) {
    return {
      sucesso: false,
      erro: error.message
    };
  }
}

// ============================================================
// FUNÇÃO: Monitorar pagamento automaticamente
// ============================================================
function monitorarPagamento(transactionId, callbacks = {}) {
  const { onPago, onPendente, onErro, onTimeout } = callbacks;
  let tentativas = 0;
  const maxTentativas = CONFIG.TIMEOUT_VERIFICACAO / CONFIG.INTERVALO_VERIFICACAO;

  console.log(`[MONITOR] Iniciando monitoramento do pagamento ${transactionId}`);

  const intervalo = setInterval(async () => {
    tentativas++;
    
    if (tentativas > maxTentativas) {
      clearInterval(intervalo);
      console.log('[MONITOR] Timeout - pagamento não confirmado');
      if (onTimeout) onTimeout();
      return;
    }

    try {
      const resultado = await verificarPagamento(transactionId);
      
      if (resultado.sucesso && resultado.pago) {
        clearInterval(intervalo);
        console.log('[MONITOR] Pagamento confirmado!');
        if (onPago) onPago(resultado);
      } else {
        console.log(`[MONITOR] Verificação ${tentativas} - Aguardando pagamento...`);
        if (onPendente) onPendente(tentativas);
      }
    } catch (error) {
      console.error('[MONITOR] Erro na verificação:', error);
      if (onErro) onErro(error);
    }
  }, CONFIG.INTERVALO_VERIFICACAO);

  // Retorna função para cancelar o monitoramento
  return () => {
    clearInterval(intervalo);
    console.log('[MONITOR] Monitoramento cancelado');
  };
}

// ============================================================
// FUNÇÃO: Copiar código PIX para a área de transferência
// ============================================================
async function copiarPix(codigoPix) {
  try {
    await navigator.clipboard.writeText(codigoPix);
    console.log('[PIX] Código copiado para a área de transferência');
    return true;
  } catch (error) {
    // Fallback para navegadores mais antigos
    const textarea = document.createElement('textarea');
    textarea.value = codigoPix;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      console.log('[PIX] Código copiado (fallback)');
      return true;
    } catch (e) {
      console.error('[PIX] Não foi possível copiar');
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }
}

// ============================================================
// EXEMPLO DE USO COMPLETO
// ============================================================

/**
 * Exemplo: Vincular ao botão "Gerar PIX"
 * 
 * Adicione no seu HTML:
 * <button id="btn-gerar-pix">Gerar PIX R$ 12,90</button>
 * <div id="pix-resultado"></div>
 * 
 * E este script fará o resto automaticamente.
 */
document.addEventListener('DOMContentLoaded', function() {
  const btnGerarPix = document.getElementById('btn-gerar-pix');
  const pixResultado = document.getElementById('pix-resultado');

  if (btnGerarPix) {
    btnGerarPix.addEventListener('click', async function() {
      // Desabilitar botão durante o processamento
      btnGerarPix.disabled = true;
      btnGerarPix.textContent = 'Gerando PIX...';

      if (pixResultado) {
        pixResultado.innerHTML = '<p style="color: #666;">Gerando seu PIX via PagamentosMP, aguarde...</p>';
      }

      // Coletar dados do formulário (se existir)
      const dadosCliente = {
        nome: document.getElementById('input-nome')?.value || 'Cliente',
        email: document.getElementById('input-email')?.value || 'cliente@email.com',
        telefone: document.getElementById('input-telefone')?.value || '11999999999',
        documento: document.getElementById('input-cpf')?.value || '00000000000'
      };

      // Gerar o PIX
      const resultado = await gerarPix(dadosCliente);

      if (resultado.sucesso) {
        // Exibir o resultado
        if (pixResultado) {
          const qrcodeImg = resultado.qrcodeBase64 || resultado.qrcodeUrl || `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(resultado.pixCopiaCola)}`;
          
          pixResultado.innerHTML = `
            <div style="background: #f0f9f0; border: 2px solid #4CAF50; border-radius: 12px; padding: 24px; text-align: center; max-width: 500px; margin: 20px auto;">
              <h3 style="color: #2e7d32; margin-bottom: 16px;">PIX Gerado com Sucesso!</h3>
              <p style="font-size: 18px; font-weight: bold; color: #333;">Valor: ${resultado.valor || 'R$ 12,90'}</p>
              
              <div style="margin: 20px 0;">
                <img src="${qrcodeImg}" alt="QR Code PIX" style="max-width: 250px; border-radius: 8px;">
              </div>
              
              <div style="background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin: 16px 0;">
                <p style="font-size: 12px; color: #666; margin-bottom: 8px;">Código PIX Copia e Cola:</p>
                <textarea id="pix-code" readonly style="width: 100%; height: 80px; border: 1px solid #ccc; border-radius: 4px; padding: 8px; font-size: 11px; resize: none;">${resultado.pixCopiaCola}</textarea>
              </div>
              
              <button onclick="copiarPix('${resultado.pixCopiaCola.replace(/'/g, "\\'")}')" 
                style="background: #4CAF50; color: white; border: none; padding: 12px 32px; border-radius: 8px; font-size: 16px; cursor: pointer; margin-top: 8px;">
                Copiar Código PIX
              </button>
              
              <p style="font-size: 12px; color: #999; margin-top: 16px;">
                ID da transação: ${resultado.transactionId || 'N/A'}
              </p>
            </div>
          `;
        }

        // Iniciar monitoramento de pagamento
        if (resultado.transactionId) {
          monitorarPagamento(resultado.transactionId, {
            onPago: (dados) => {
              if (pixResultado) {
                pixResultado.innerHTML += `
                  <div style="background: #e8f5e9; border: 2px solid #4CAF50; border-radius: 12px; padding: 20px; text-align: center; margin-top: 16px;">
                    <h3 style="color: #2e7d32;">Pagamento Confirmado!</h3>
                    <p>Seu pagamento foi recebido com sucesso.</p>
                  </div>
                `;
              }
            },
            onPendente: (tentativa) => {
              console.log(`Verificação ${tentativa} - Aguardando pagamento...`);
            },
            onTimeout: () => {
              console.log('Tempo de verificação expirado');
            }
          });
        }
      } else {
        // Exibir erro
        if (pixResultado) {
          pixResultado.innerHTML = `
            <div style="background: #fce4ec; border: 2px solid #f44336; border-radius: 12px; padding: 24px; text-align: center;">
              <h3 style="color: #c62828;">Erro ao Gerar PIX</h3>
              <p>${resultado.erro || 'Erro desconhecido. Tente novamente.'}</p>
              <button onclick="location.reload()" style="background: #f44336; color: white; border: none; padding: 10px 24px; border-radius: 8px; cursor: pointer; margin-top: 12px;">
                Tentar Novamente
              </button>
            </div>
          `;
        }
      }

      // Reabilitar botão
      btnGerarPix.disabled = false;
      btnGerarPix.textContent = 'Gerar PIX R$ 12,90';
    });
  }
});

// ============================================================
// EXPORTAR FUNÇÕES PARA USO GLOBAL
// ============================================================
window.PixIntegracao = {
  gerarPix,
  gerarPixViaAPI,
  verificarPagamento,
  monitorarPagamento,
  copiarPix,
  CONFIG
};

console.log('[PIX Integração] Script carregado com sucesso! (Gateway: PagamentosMP)');
console.log('[PIX Integração] Use window.PixIntegracao.gerarPix() para gerar um PIX');
