import { expect, test } from 'bun:test'
import { clipForSpeed, guideLook, MODEL_IDS, pickModel } from '../src/characters/catalog'

test('pickModel: один ключ — одна модель, разные ключи покрывают пак', () => {
  expect(pickModel('u1')).toBe(pickModel('u1'))
  const seen = new Set(Array.from({ length: 50 }, (_, i) => pickModel(`user-${i}`)))
  expect(seen.size).toBeGreaterThanOrEqual(6)
  for (const m of seen) expect(MODEL_IDS).toContain(m)
})

test('guideLook: по id, по имени без регистра, незнакомый — null', () => {
  expect(guideLook('guide_monet', 'x')?.accessories).toContain('boater')
  expect(guideLook('g7', 'Леонардо да Винчи')?.accessories).toContain('beret')
  expect(guideLook('g8', 'ВИНСЕНТ ВАН ГОГ')).not.toBeNull()
  // id гидов бэка
  expect(guideLook('guide_leonardo', 'x')?.accessories).toContain('beret')
  expect(guideLook('guide_vangogh', 'x')?.accessories).toContain('straw-wide')
  expect(guideLook('guide_herodotus', 'Геродот')).toBeNull()
})

test('clipForSpeed: стоит, идёт, бежит; телепорт — стоит', () => {
  expect(clipForSpeed(0)).toBe('idle')
  expect(clipForSpeed(1.5)).toBe('walk')
  expect(clipForSpeed(3.6)).toBe('walk')
  expect(clipForSpeed(5)).toBe('sprint')
  expect(clipForSpeed(40)).toBe('idle')
})

test('Figure.dispose освобождает скелеты клона (текстуры костей на GPU)', async () => {
  const THREE = await import('three')
  const { Figure } = await import('../src/characters/library')
  const bone = new THREE.Bone()
  bone.name = 'head'
  const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
  mesh.name = 'body-mesh'
  const scene = new THREE.Group()
  scene.add(bone, mesh)
  mesh.bind(new THREE.Skeleton([bone]))
  const fig = new Figure({ scene, clips: new Map(), scale: 1 })
  const skeletons: THREE.Skeleton[] = []
  fig.root.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && skeletons.push((o as THREE.SkinnedMesh).skeleton))
  let disposed = 0
  for (const s of skeletons) s.dispose = () => void disposed++
  fig.dispose()
  expect(skeletons.length).toBe(1)
  expect(disposed).toBe(1)
})
