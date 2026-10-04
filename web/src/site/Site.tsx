import { useEffect, useState } from 'react';

import { api } from '../api';
import SignupModal from './SignupModal';
import Account from './Account';
import { accountPath, isAccountPage } from './paths';
import './site.css';

// Página de divulgação do Pontual (no domínio principal): o que o sistema
// faz, para quem, exemplos de telas, preço e o cadastro com dias de teste

export interface Segment {
  key: string;
  name: string;
  samples?: string[];
  vocabulary?: { professional: string; client: string; place: string };
}

export interface PublicInfo {
  signup_enabled: boolean;
  trial_days: number;
  price_cents: number;
  base_domain: string;
  support_whatsapp?: string | null;
  segments: Segment[];
}

const FALLBACK: PublicInfo = {
  signup_enabled: true,
  trial_days: 7,
  price_cents: 9900,
  base_domain: 'pontual.app',
  segments: [
    { key: 'barbershop', name: 'Barbearia' },
    { key: 'beauty', name: 'Salão de beleza / estética' },
    { key: 'tattoo', name: 'Estúdio de tatuagem' },
    { key: 'physio', name: 'Fisioterapia' },
    { key: 'clinic', name: 'Consultório' },
  ],
};

// O que cada ramo ganha de diferente
const SEGMENT_HIGHLIGHTS: Record<string, { icon: string; text: string }> = {
  barbershop: {
    icon: '✂',
    text: 'Clube de assinatura, encaixe de quem chega sem horário e cliente fixo.',
  },
  beauty: {
    icon: '✿',
    text: 'Pacotes de sessões, vários profissionais e lista de espera.',
  },
  tattoo: {
    icon: '✒',
    text: 'Sinal para garantir o horário, termo de consentimento e sessões longas.',
  },
  physio: {
    icon: '♥',
    text: 'Pacotes de sessões, horário fixo semanal e termo de consentimento.',
  },
  clinic: {
    icon: '✚',
    text: 'Termo de consentimento, retornos sem custo e cadastro com CPF.',
  },
};

const FEATURES = [
  {
    title: 'Site de agendamento próprio',
    text: 'Seu endereço na internet, com serviços, equipe, horários e o botão de agendar. Seus clientes marcam sozinhos, 24 horas por dia.',
  },
  {
    title: 'Agenda da equipe',
    text: 'Dia e semana de cada profissional, arrastar para remarcar, bloqueios de almoço e folga, encaixes e cliente fixo.',
  },
  {
    title: 'Lembretes e confirmação',
    text: 'Mensagens prontas no WhatsApp e link de confirmação na véspera. Menos faltas e menos horários vazios.',
  },
  {
    title: 'Caixa do dia',
    text: 'O que entrou em Pix, cartão e dinheiro, fechamento da gaveta e os atendimentos que faltam registrar.',
  },
  {
    title: 'Clientes',
    text: 'Ficha com histórico, observações, faltas e quanto cada um já gastou. Filtros de aniversariantes e de quem sumiu.',
  },
  {
    title: 'Planos, pacotes e sinal',
    text: 'Assinatura mensal, pacotes de sessões e sinal para garantir o horário, conforme o seu ramo.',
  },
  {
    title: 'Indicadores',
    text: 'Faturamento, ocupação da agenda, taxa de faltas, serviços mais pedidos e os horários mais cheios.',
  },
  {
    title: 'Equipe e permissões',
    text: 'Cada pessoa com o seu acesso: profissional vê a própria agenda, recepção cuida de tudo, o dono vê os números.',
  },
];

const EXAMPLES = [
  {
    key: 'agenda',
    label: 'Agenda',
    image: '/marketing/agenda.jpg',
    caption: 'A agenda do dia com toda a equipe: horários, serviços, bloqueios e quem ainda não confirmou.',
  },
  {
    key: 'site',
    label: 'Seu site',
    image: '/marketing/site.jpg',
    caption: 'O site do seu negócio, com a sua cor, logo e foto de capa. Pronto no momento do cadastro.',
  },
  {
    key: 'agendar',
    label: 'Cliente agendando',
    image: '/marketing/agendar.jpg',
    caption: 'O cliente escolhe o serviço, o profissional e o horário livre. Sem ligação, sem troca de mensagens.',
  },
  {
    key: 'caixa',
    label: 'Caixa',
    image: '/marketing/caixa.jpg',
    caption: 'O caixa do dia separado por forma de pagamento, com o fechamento da gaveta.',
  },
  {
    key: 'indicadores',
    label: 'Indicadores',
    image: '/marketing/indicadores.jpg',
    caption: 'Os números do negócio: faturamento, ocupação, faltas e os serviços que mais saem.',
  },
];

const FAQ = [
  {
    q: 'Preciso de cartão de crédito para testar?',
    a: 'Não. Você se cadastra, o sistema entra no ar na hora e você usa tudo durante o período de teste.',
  },
  {
    q: 'O que acontece quando o teste acaba?',
    a: 'Se quiser continuar, é só combinar a mensalidade com a gente. Sem pagamento, o sistema fica pausado e os seus dados continuam guardados.',
  },
  {
    q: 'Meus clientes precisam baixar algum aplicativo?',
    a: 'Não. Eles agendam pelo site do seu negócio, no celular ou no computador.',
  },
  {
    q: 'Posso usar o meu próprio domínio?',
    a: 'Pode. Seu negócio começa num endereço nosso e depois pode passar para um domínio seu (ex.: www.seunegocio.com.br).',
  },
  {
    q: 'Funciona para o meu ramo?',
    a: 'O sistema se adapta ao ramo escolhido no cadastro: os nomes nas telas (paciente, tatuador, estúdio...), os serviços de exemplo e os recursos ligados.',
  },
];

function price(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function Site() {
  const [info, setInfo] = useState<PublicInfo>(FALLBACK);
  const [signup, setSignup] = useState<string | null>(null);
  const [example, setExample] = useState(EXAMPLES[0].key);
  const [open, setOpen] = useState<number | null>(0);

  useEffect(() => {
    api<PublicInfo>('/public/info')
      .then(data => setInfo({ ...data, segments: data.segments.length ? data.segments : FALLBACK.segments }))
      .catch(() => undefined);
  }, []);

  const start = (segment?: string) => setSignup(segment || info.segments[0]?.key || 'barbershop');

  // Área do cliente (conta e dados do negócio)
  if (isAccountPage()) return <Account info={info} />;
  const current = EXAMPLES.find(item => item.key === example) || EXAMPLES[0];

  return (
    <div className="mk">
      <header className="mk-header">
        <div className="mk-wrap mk-header-row">
          <a href="#topo" className="mk-brand">
            <span className="mk-mark">P</span>
            Pontual
          </a>
          <nav className="mk-nav" aria-label="Seções">
            <a href="#recursos">Recursos</a>
            <a href="#ramos">Para quem</a>
            <a href="#exemplos">Exemplos</a>
            <a href="#preco">Preço</a>
          </nav>
          <a href={accountPath()} className="mk-header-login">
            Entrar
          </a>
          <button type="button" className="mk-btn mk-btn-primary mk-btn-small" onClick={() => start()}>
            Testar grátis
          </button>
        </div>
      </header>

      <main id="topo">
        <section className="mk-hero">
          <div className="mk-wrap mk-hero-grid">
            <div>
              <span className="mk-pill">{`${info.trial_days} dias grátis · sem cartão`}</span>
              <h1>A agenda online que trabalha pelo seu negócio</h1>
              <p className="mk-lead">
                Site de agendamento próprio, agenda da equipe, lembretes no WhatsApp, caixa e relatórios.
                Para barbearias, salões, estúdios de tatuagem, fisioterapia e consultórios.
              </p>
              <div className="mk-actions">
                <button type="button" className="mk-btn mk-btn-primary" onClick={() => start()}>
                  {`Começar teste grátis de ${info.trial_days} dias`}
                </button>
                <a href="#exemplos" className="mk-btn mk-btn-ghost">
                  Ver como funciona
                </a>
              </div>
              <p className="mk-note">Crie sua conta, preencha os dados do negócio e o sistema entra no ar na hora.</p>
            </div>
            <figure className="mk-frame">
              <div className="mk-frame-bar">
                <i />
                <i />
                <i />
                <span>{`seunegocio.${info.base_domain}`}</span>
              </div>
              <img src="/marketing/agenda.jpg" alt="Agenda do dia no Pontual" width={1440} height={900} />
            </figure>
          </div>
        </section>

        <section className="mk-section" id="recursos">
          <div className="mk-wrap">
            <span className="mk-eyebrow">Recursos</span>
            <h2>Tudo o que o atendimento com hora marcada precisa</h2>
            <div className="mk-features">
              {FEATURES.map(item => (
                <article key={item.title} className="mk-card">
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mk-section mk-section-alt" id="ramos">
          <div className="mk-wrap">
            <span className="mk-eyebrow">Para quem</span>
            <h2>Feito para o seu ramo</h2>
            <p className="mk-sub">
              Escolha o ramo no cadastro: o sistema já vem com os nomes certos nas telas, serviços de exemplo e
              os recursos que fazem sentido para você.
            </p>
            <div className="mk-segments">
              {info.segments.map(segment => {
                const highlight = SEGMENT_HIGHLIGHTS[segment.key];

                return (
                  <article key={segment.key} className="mk-card mk-segment">
                    <span className="mk-segment-icon" aria-hidden="true">
                      {highlight?.icon || '●'}
                    </span>
                    <h3>{segment.name}</h3>
                    {highlight && <p>{highlight.text}</p>}
                    {segment.samples && segment.samples.length > 0 && (
                      <p className="mk-samples">{`Começa com: ${segment.samples.join(', ')}`}</p>
                    )}
                    <button type="button" className="mk-link" onClick={() => start(segment.key)}>
                      Testar como {segment.name.split(' /')[0].toLowerCase()} →
                    </button>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="mk-section" id="exemplos">
          <div className="mk-wrap">
            <span className="mk-eyebrow">Exemplos</span>
            <h2>Veja o sistema por dentro</h2>
            <div className="mk-tabs" role="tablist" aria-label="Telas do sistema">
              {EXAMPLES.map(item => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={item.key === example}
                  className={item.key === example ? 'active' : ''}
                  onClick={() => setExample(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <figure className="mk-frame mk-example">
              <div className="mk-frame-bar">
                <i />
                <i />
                <i />
                <span>{`seunegocio.${info.base_domain}`}</span>
              </div>
              <img src={current.image} alt={current.label} width={1440} height={900} />
            </figure>
            <p className="mk-caption">{current.caption}</p>
          </div>
        </section>

        <section className="mk-section mk-section-alt">
          <div className="mk-wrap">
            <span className="mk-eyebrow">Como funciona</span>
            <h2>Do cadastro ao primeiro agendamento</h2>
            <ol className="mk-steps">
              <li>
                <strong>Crie sua conta</strong>
                <p>Nome, e-mail, WhatsApp e senha. Depois, na sua área, o nome do negócio, o ramo e o endereço.</p>
              </li>
              <li>
                <strong>Seu sistema entra no ar</strong>
                <p>{`Na hora, em seunegocio.${info.base_domain}, com serviços de exemplo do seu ramo.`}</p>
              </li>
              <li>
                <strong>Ajuste e divulgue</strong>
                <p>Coloque seus preços, sua equipe e os horários, e mande o link para os clientes.</p>
              </li>
            </ol>
          </div>
        </section>

        <section className="mk-section" id="preco">
          <div className="mk-wrap mk-pricing">
            <div>
              <span className="mk-eyebrow">Preço</span>
              <h2>Um plano, tudo incluso</h2>
              <p className="mk-sub">
                Sem limite de agendamentos e de clientes. Comece com o teste grátis e decida depois.
              </p>
            </div>
            <div className="mk-card mk-plan">
              <span className="mk-pill">{`${info.trial_days} dias grátis`}</span>
              <p className="mk-price">
                {price(info.price_cents)}
                <small>/mês</small>
              </p>
              <ul>
                <li>Site de agendamento com o seu endereço</li>
                <li>Agenda, clientes, caixa e indicadores</li>
                <li>Equipe com permissões</li>
                <li>Planos, pacotes, sinal e termo, conforme o ramo</li>
                <li>Domínio próprio, se quiser</li>
              </ul>
              <button type="button" className="mk-btn mk-btn-primary" onClick={() => start()}>
                Começar teste grátis
              </button>
            </div>
          </div>
        </section>

        <section className="mk-section mk-section-alt">
          <div className="mk-wrap mk-faq">
            <span className="mk-eyebrow">Dúvidas</span>
            <h2>Perguntas frequentes</h2>
            {FAQ.map((item, index) => (
              <div key={item.q} className="mk-faq-item">
                <button
                  type="button"
                  aria-expanded={open === index}
                  onClick={() => setOpen(open === index ? null : index)}
                >
                  {item.q}
                  <span aria-hidden="true">{open === index ? '−' : '+'}</span>
                </button>
                {open === index && <p>{item.a}</p>}
              </div>
            ))}
          </div>
        </section>

        <section className="mk-cta">
          <div className="mk-wrap">
            <h2>Pronto para parar de anotar no caderno?</h2>
            <button type="button" className="mk-btn mk-btn-primary" onClick={() => start()}>
              {`Testar grátis por ${info.trial_days} dias`}
            </button>
          </div>
        </section>
      </main>

      <footer className="mk-footer">
        <div className="mk-wrap">
          <span>{`© ${new Date().getFullYear()} Pontual`}</span>
          <span>Agenda online para negócios com hora marcada</span>
        </div>
      </footer>

      {signup && <SignupModal info={info} initialSegment={signup} onClose={() => setSignup(null)} />}
    </div>
  );
}
