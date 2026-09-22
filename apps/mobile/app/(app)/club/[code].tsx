import { useEffect } from 'react'
import { ActivityIndicator, Alert, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { formatClubLabel, inferHoleCount, type Club } from '@oga/core'
import { getUserBag } from '@oga/supabase'
import { useAuth } from '../../../hooks/useAuth'
import { supabase } from '../../../lib/supabase'

const CLUB_CODE_MAP = {
  DR: 'driver',
  '3W': '3w',
  '5W': '5w',
  '4H': '4h',
  '5I': '5i',
} as const satisfies Record<string, Club>

export default function ClubDeepLink() {
  const { code } = useLocalSearchParams<{ code?: string | string[] }>()
  const { user } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!user) return
    let active = true

    ;(async () => {
      const rawCode = Array.isArray(code) ? code[0] : code
      const club = rawCode
        ? (CLUB_CODE_MAP[rawCode.trim().toUpperCase() as keyof typeof CLUB_CODE_MAP] ?? null)
        : null
      if (!club) {
        Alert.alert('Unknown club tag', 'This NFC tag is not configured for OGA.')
        router.replace('/(app)')
        return
      }

      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const [roundRes, bagRes] = await Promise.all([
        supabase
          .from('rounds')
          .select('id')
          .eq('user_id', user.id)
          .is('completed_at', null)
          .is('total_score', null)
          .gte('played_at', oneDayAgo)
          .order('played_at', { ascending: false })
          .limit(1),
        getUserBag(supabase, user.id),
      ])
      if (!active) return

      if (roundRes.error || bagRes.error) {
        Alert.alert('Club selection failed', 'Check your connection and scan again.')
        router.replace('/(app)')
        return
      }

      const round = roundRes.data?.[0]
      if (!round) {
        Alert.alert('No active round', 'Start or resume a round before scanning a club.')
        router.replace('/(app)')
        return
      }

      const configured = (bagRes.data ?? []).some((c) => c.club_type === club)
      if (!configured) {
        const label = formatClubLabel({ club_type: club })
        Alert.alert('Club not in your bag', `Add ${label} to your OGA bag before using this tag.`)
        router.replace({ pathname: '/(app)/round/[id]', params: { id: round.id } })
        return
      }

      const { data: holeScores, error: holeError } = await supabase
        .from('hole_scores')
        .select('score, holes(number)')
        .eq('round_id', round.id)
      if (!active) return
      if (holeError) {
        Alert.alert('Club selection failed', 'Check your connection and scan again.')
        router.replace({ pathname: '/(app)/round/[id]', params: { id: round.id } })
        return
      }

      const rows = (holeScores ?? []) as Array<{
        score: number | null
        holes?: { number?: number | null } | null
      }>
      const holeNumbers = rows
        .map((row) => row.holes?.number)
        .filter((n): n is number => typeof n === 'number')
      const holeCount = inferHoleCount(holeNumbers)
      const lastScoredHole = rows.reduce((max, row) => {
        const number = row.holes?.number
        return (row.score ?? 0) > 0 && typeof number === 'number' ? Math.max(max, number) : max
      }, 0)
      const hole = Math.min(holeCount, Math.max(1, lastScoredHole + 1))

      router.replace({
        pathname: '/(app)/round/[id]',
        params: {
          id: round.id,
          hole: String(hole),
          club,
          clubToken: String(Date.now()),
        },
      })
    })()

    return () => {
      active = false
    }
  }, [code, router, user])

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#1C211C',
      }}
    >
      <ActivityIndicator color="#F2EEE5" />
    </View>
  )
}
