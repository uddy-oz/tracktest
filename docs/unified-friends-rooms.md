# Play With Friends

Play With Friends replaces Duel and Group Lobby as entry choices. The two
match formats, the existing competitive engine, legacy rooms and invitations,
and the separate Party Mode are retained. Championship is still unavailable.

## Room lifecycle

- A Friends room uses the existing Group Lobby storage type while waiting,
  with a server-controlled `unified_friends` flag and capacity of ten. It
  gets one collision-checked invite code whether public or private. Public
  codes resolve to the existing public join operation; private codes still
  use the existing private join operation. Both lock the room before joining.
- The host starts from a refreshed room and trusted question set. A small
  start RPC locks the same room row, checks the expected album and exact
  roster against the current data, and rejects a stale request. Two players
  select the existing Duel format, and three to ten select Group Lobby.
  The existing activation validates host, generation, questions and ready
  flags and starts the same audio readiness and synchronization flow.
  The group-to-duel selection (room and staged question set) is atomic with
  activation; any failure leaves the room waiting in its original format.
- Once preparation begins, the existing join operations reject new
  admission. Actual participants retain the existing reconnect and departure
  rules. Ordinary rematches increment the generation and return to a
  ten-slot Friends lobby with the same ID, host and invitation code.
- The finalizer saves the actual format for each generation. The public
  history view reads that saved format for Friends results so a later
  rematch cannot relabel an old result. Legacy results keep their existing
  read path. Existing ranks, badges, Daily Goals, guest exclusion and answer
  key protections continue to consume the same result types.

## Release and rollback

The UI cannot fully implement this safely without the database change: the
existing Group Lobby start requires three players, and scoring/progression
derive format from authoritative room state. Apply
`supabase/20261117_unified_friends_rooms.sql` before a separately approved
frontend rollout. It adds a default-false column, two authenticated RPCs,
a rematch trigger, and a history-view change. It does not update historical
rooms or results and does not replace the existing scoring engine or RLS.

Before any production rollout, capture a current backup and validate the
transaction against the actual release schema, including its effective RPC
grants, existing maintenance guards and public profile view. Apply the SQL
once, confirm existing clients/legacy rooms are unaffected, then deploy the
matching app. Smoke-test new private and public codes, a two-player finish,
and an expanded rematch. Old clients can still read and join existing rooms;
the new creation and two-player Friends start require the updated frontend.

For an app rollback, stop new Friends creation by revoking authenticated
execution of `create_friends_room`, drain active Friends matches and resolve
waiting rooms through existing room controls before restoring the old UI.
Keep the additive schema, start/rematch logic and history view in place;
rolling back the view or removing the marker would risk relabeling saved
Friends results. Do not rewrite results, delete players or reset the database.

## Test boundaries

The local integration uses disposable real Supabase Auth users and protected
question fixtures. It exercises 2/3/5/10 starts, shared questions and start
times, atomic capacity, the join-versus-start race, late invite rejection,
Duel-to-Group rematch, historical labels, and the corresponding win badges.
The badge cases submit a real competitive answer, then complete the fixture
using synthetic remaining-round data. The existing lifecycle and maintenance
suites cover legacy host departure, reconnect, forfeit and Party behavior.
Browser QA uses fixture REST replies for new room creation and legacy invite
entry. Physical devices, audible multi-client playback, and WebSocket delivery
through an end-to-end Realtime stack still need a manual multiplayer pass.
