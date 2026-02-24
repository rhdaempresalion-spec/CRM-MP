/**
 * ============================================================
 * SCRIPT DE INTEGRAÇÃO - Gerador de PIX via PagamentosMP
 * ============================================================
 * 
 * Este script gera um PIX NOVO a cada requisição.
 * Sem cache, sem monitoramento, sem reutilização.
 * 
 * COMO USAR:
 * 1. Inclua este script na sua página HTML
 * 2. Configure a URL_BACKEND com a URL do seu servidor (Railway)
 * 3. Chame a função gerarPix() quando quiser gerar um PIX
 * 
 * ============================================================
 */

// ============================================================
// CONFIGURAÇÃO
// ============================================================
const CONFIG = {
  URL_BACKEND: window.PIX_BACKEND_URL || 'https://seu-app.up.railway.app'
};

// ============================================================
// FUNÇÃO PRINCIPAL: Gerar PIX NOVO
// ============================================================
async function gerarPix(dadosCliente = {}) {
  console.log('[PIX] Gerando PIX NOVO via PagamentosMP...');
  
  const payload = {
    nome: dadosCliente.nome || 'Cliente',
    email: dadosCliente.email || 'cliente@email.com',
    telefone: dadosCliente.telefone || '11999999999',
    documento: dadosCliente.documento || dadosCliente.cpf || '00000000000',
    numero_do_lead: dadosCliente.numero_do_lead || dadosCliente.telefone || '',
    origem: 'javascript_integracao',
    timestamp: new Date().toISOString()
  };

  try {
    const response = await fetch(`${CONFIG.URL_BACKEND}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const resultado = await response.json();

    if (resultado.sucesso && resultado.pix) {
      console.log('[PIX] PIX NOVO gerado com sucesso!');
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
    return {
      sucesso: false,
      erro: 'Não foi possível gerar o PIX. Tente novamente.',
      detalhes: error.message
    };
  }
}

// ============================================================
// FUNÇÃO: Gerar PIX via API direta
// ============================================================
async function gerarPixViaAPI(dadosCliente = {}) {
  console.log('[PIX API] Gerando PIX NOVO via /api/gerar-pix...');
  
  const payload = {
    nome: dadosCliente.nome || 'Cliente',
    email: dadosCliente.email || 'cliente@email.com',
    telefone: dadosCliente.telefone || '11999999999',
    documento: dadosCliente.documento || '00000000000',
    numero_do_lead: dadosCliente.numero_do_lead || dadosCliente.telefone || ''
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
// FUNÇÃO: Copiar código PIX para a área de transferência
// ============================================================
async function copiarPix(codigoPix) {
  try {
    await navigator.clipboard.writeText(codigoPix);
    console.log('[PIX] Código copiado para a área de transferência');
    return true;
  } catch (error) {
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
// VINCULAR AO BOTÃO DA PÁGINA
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
  const btnGerarPix = document.getElementById('btn-gerar-pix');
  const pixResultado = document.getElementById('pix-resultado');

  if (btnGerarPix) {
    btnGerarPix.addEventListener('click', async function() {
      btnGerarPix.disabled = true;
      btnGerarPix.textContent = 'Gerando PIX NOVO...';

      if (pixResultado) {
        pixResultado.innerHTML = '<p style="color: #666;">Gerando seu PIX NOVO via PagamentosMP, aguarde...</p>';
      }

      const dadosCliente = {
        nome: document.getElementById('input-nome')?.value || 'Cliente',
        email: document.getElementById('input-email')?.value || 'cliente@email.com',
        telefone: document.getElementById('input-telefone')?.value || '11999999999',
        documento: document.getElementById('input-cpf')?.value || '00000000000'
      };

      const resultado = await gerarPix(dadosCliente);

      if (resultado.sucesso) {
        if (pixResultado) {
          const qrcodeImg = resultado.qrcodeBase64 || resultado.qrcodeUrl || `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(resultado.pixCopiaCola)}`;
          
          pixResultado.innerHTML = `
            <div style="background: #e8f5e9; border: 2px solid #4CAF50; border-radius: 12px; padding: 24px; text-align: center; margin-top: 16px;">
              <h3 style="color: #2e7d32; margin-bottom: 16px;">PIX NOVO Gerado com Sucesso!</h3>
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
      } else {
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
  copiarPix,
  CONFIG
};

console.log('[PIX] Script carregado! Cada chamada gera um PIX NOVO e único.');
console.log('[PIX] Use window.PixIntegracao.gerarPix() para gerar um PIX');
