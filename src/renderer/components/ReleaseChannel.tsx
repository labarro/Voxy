import { useEffect, useState } from "react";
import { Megaphone, Sparkles, Wrench, Check } from "lucide-react";
import type { ReleasePost } from "../../shared/types";
export function ReleaseChannel() {
  const [posts, setPosts] = useState<ReleasePost[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    const load=()=>void window.voxy
      .releaseHistory()
      .then(setPosts)
      .catch((e) => setError(e.message));
    load();
    return window.voxy.onEvent(event=>{if(event.type==="remote-update"&&["available","ready","up-to-date"].includes(event.state.phase))load();});
  }, []);
  return (
    <section className="release-channel">
      <header>
        <Megaphone size={30} />
        <div>
          <h1>Novidades do Voxy</h1>
          <p>
            O canal oficial de atualizações. Disponível mesmo sem uma sala ou
            conexão à rede.
          </p>
        </div>
      </header>
      <p className="hint">
        Histórico da instalação e publicações remotas com assinatura verificada. As últimas novidades consultadas ficam disponíveis offline.
      </p>
      {error && (
        <p role="alert" className="modal-error">
          {error}
        </p>
      )}
      {posts.map((post) => (
        <article className="release-post" key={post.version}>
          <div className="release-meta">
            <strong>Voxy {post.version}</strong>
            <time dateTime={post.date}>
              {new Date(post.date + "T12:00:00").toLocaleDateString("pt-BR")}
            </time>
          </div>
          <h2>{post.title}</h2>
          {(
            [
              ["features", "Novas funcionalidades", Sparkles],
              ["improvements", "Melhorias", Check],
              ["fixes", "Correções", Wrench],
            ] as const
          ).map(([field, title, Icon]) => (
            <section key={field}>
              <h3>
                <Icon size={16} />
                {title}
              </h3>
              {post[field].length ? (
                <ul>
                  {post[field].map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="hint">
                  Nenhuma alteração listada nesta categoria.
                </p>
              )}
            </section>
          ))}
        </article>
      ))}
    </section>
  );
}
