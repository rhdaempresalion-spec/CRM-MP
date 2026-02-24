# CRM PIX - Backend de Geração Automática de PIX (PagamentosMP)

Backend Node.js para geração automática de cobranças PIX via **API PagamentosMP**, com integração ao CRM DataCrazy via webhooks.

## Visão Geral

Este sistema recebe webhooks do CRM, gera cobranças PIX automaticamente via PagamentosMP, envia os dados de volta ao CRM e monitora o pagamento em tempo real.

## Fluxo de Funcionamento

1. O CRM envia um webhook com os dados do lead para `/webhook`
2. O backend gera uma cobrança PIX via API PagamentosMP
3. O código PIX (copia e cola) e QR Code são enviados de volta ao CRM
4. O sistema monitora automaticamente o pagamento a cada 15 segundos
5. Quando o pagamento é confirmado, envia notificação ao CRM

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Página de demonstração |
| GET | `/health` | Status detalhado + monitor |
| POST | `/webhook` | Receber webhook do CRM e gerar PIX |
| POST | `/api/gerar-pix` | Gerar PIX via API direta |
| GET | `/api/status/:id` | Verificar status de pagamento |
| GET | `/api/monitor` | Status do monitor de pagamentos |
| POST | `/webhook/mp-callback` | Callback de notificação da PagamentosMP |

## Deploy no Railway

1. Faça push do código para o GitHub
2. Acesse [railway.app](https://railway.app)
3. Crie um novo projeto e conecte o repositório GitHub
4. Configure as variáveis de ambiente:

```
MP_PUBLIC_KEY=sua_public_key
MP_SECRET_KEY=sua_secret_key
MP_API_URL=https://app.pagamentosmp.com/api/v1
CRM_WEBHOOK_URL=https://api.datacrazy.io/v1/crm/api/crm/flows/webhooks/SEU_ID/SEU_WEBHOOK
PIX_VALOR=12.90
PIX_EXPIRACAO_DIAS=1
PIX_PRODUTO_NOME=Pagamento PIX
PORT=3000
NODE_ENV=production
```

5. O Railway fará o deploy automaticamente

## Integração JavaScript

Inclua o script `script-integracao.js` na sua página:

```html
<script>
  window.PIX_BACKEND_URL = 'https://seu-app.up.railway.app';
</script>
<script src="https://seu-app.up.railway.app/script-integracao.js"></script>
```

Depois use:

```javascript
// Gerar PIX
const resultado = await window.PixIntegracao.gerarPix({
  nome: 'João Silva',
  email: 'joao@email.com',
  telefone: '11999999999',
  documento: '12345678900'
});

if (resultado.sucesso) {
  console.log('Código PIX:', resultado.pixCopiaCola);
}
```

## Desenvolvimento Local

```bash
npm install
cp .env.example .env
# Edite o .env com suas credenciais PagamentosMP
npm start
```

## Estrutura do Projeto

```
├── src/
│   ├── index.js           # Servidor Express e rotas
│   ├── mp-service.js      # Integração com API PagamentosMP
│   ├── crm-service.js     # Envio de dados ao CRM
│   └── monitor-service.js # Monitor automático de pagamentos
├── public/
│   ├── index.html         # Página de demonstração
│   └── script-integracao.js # Script JS para integração frontend
├── .env.example
├── package.json
├── Dockerfile
└── README.md
```

## API PagamentosMP - Referência

- **Autenticação**: Headers `x-public-key` e `x-secret-key`
- **Criar PIX**: `POST /gateway/pix/receive`
- **Consultar**: `GET /gateway/transactions?id={id}`
- **Status pago**: `COMPLETED`
- **Valor**: Em reais (ex: 12.90)

## Licença

ISC
