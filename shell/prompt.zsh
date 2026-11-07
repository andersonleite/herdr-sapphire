# prompt.zsh — prompt do layout herdr-sapphire
#
# Zsh puro, sem dependências: funciona em qualquer máquina com zsh 5+.
# As cores usam os 16 ANSI (%F{1..6}), então seguem o tema do terminal.
#
#   ~/Developer/agent-home  main ✚ ⇡1                                  12s
#   ❯
#
# Linha 1: caminho (azul) · branch git (verde limpa / amarela com mudanças)
# Linha 2: ❯ verde, ou vermelho se o último comando falhou
# Direita: duração do último comando quando passa de 5 s
# user@host aparece só em sessão SSH.

# Não carregar duas vezes (ex.: source repetido no .zshrc).
[[ -n ${_HS_PROMPT_LOADED-} ]] && return
_HS_PROMPT_LOADED=1

setopt PROMPT_SUBST
autoload -Uz vcs_info add-zsh-hook

# ---------- git (vcs_info) ----------
zstyle ':vcs_info:*' enable git
zstyle ':vcs_info:*' check-for-changes true
zstyle ':vcs_info:*' stagedstr '●'
zstyle ':vcs_info:*' unstagedstr '✚'
# %b branch · %c staged · %u unstaged · %m extras (untracked, ahead/behind)
zstyle ':vcs_info:git:*' formats       '%b%c%u%m'
zstyle ':vcs_info:git:*' actionformats '%b|%a%c%u%m'
zstyle ':vcs_info:git*+set-message:*' hooks git-untracked git-aheadbehind

# Marca "?" quando há arquivos não rastreados.
+vi-git-untracked() {
  if git rev-parse --is-inside-work-tree &>/dev/null \
     && [[ -n $(git ls-files --others --exclude-standard 2>/dev/null | head -n 1) ]]; then
    hook_com[misc]+='?'
  fi
}

# ⇡n / ⇣n em relação ao upstream.
+vi-git-aheadbehind() {
  local ahead behind
  ahead=$(git rev-list --count @{upstream}..HEAD 2>/dev/null) || return
  behind=$(git rev-list --count HEAD..@{upstream} 2>/dev/null) || return
  (( ahead ))  && hook_com[misc]+=" ⇡${ahead}"
  (( behind )) && hook_com[misc]+=" ⇣${behind}"
}

# Monta o trecho do git já colorido: verde limpo, amarelo com mudanças.
_hs_git_segment() {
  [[ -z $vcs_info_msg_0_ ]] && return
  local info=$vcs_info_msg_0_
  if [[ $info == *[●✚?]* || $info == *'|'* ]]; then
    print -n "  %F{3}${info}%f"
  else
    print -n "  %F{2}${info}%f"
  fi
}

# ---------- duração do último comando ----------
_hs_cmd_start=
_hs_cmd_elapsed=

_hs_preexec() { _hs_cmd_start=$EPOCHREALTIME }

_hs_precmd() {
  _hs_cmd_elapsed=
  if [[ -n $_hs_cmd_start ]]; then
    local -i secs=$(( EPOCHREALTIME - _hs_cmd_start ))
    if (( secs >= 5 )); then
      if (( secs >= 60 )); then
        _hs_cmd_elapsed=$(printf '%dm %02ds' $(( secs / 60 )) $(( secs % 60 )))
      else
        _hs_cmd_elapsed="${secs}s"
      fi
    fi
    _hs_cmd_start=
  fi
  vcs_info
}

zmodload zsh/datetime
add-zsh-hook preexec _hs_preexec
add-zsh-hook precmd  _hs_precmd

# ---------- montagem ----------
# user@host só quando a sessão é remota.
_hs_host_segment() {
  [[ -n ${SSH_CONNECTION-}${SSH_TTY-} ]] && print -n "%F{5}%n@%m%f "
}

PROMPT='$(_hs_host_segment)%F{4}%3~%f$(_hs_git_segment)
%(?.%F{2}.%F{1})❯%f '
RPROMPT='%F{8}${_hs_cmd_elapsed}%f'
