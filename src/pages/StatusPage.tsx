import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ReloadOutlined, SaveOutlined, InfoCircleTwoTone, EyeTwoTone, ToolTwoTone } from '@ant-design/icons'
import { Card, Typography, Tag, Layout, PageHeader, Button, Space, Menu, Dropdown, Spin } from 'antd'
import { apihost, defaulted, batched } from '../Misc'
import '../App.less'
import EditorUI from '../components/EditorUI'
import MessagePane from '../components/MessagePane'
import * as Types from '../Types'
import _ from 'lodash'
import EditorButtons from '../components/EditorButtons'
import AudioPosition, { drawAudioPercent, clearAudioPosition } from '../components/AudioPosition'
import Waveform from '../components/Waveform'
import Timeline from '../components/Timeline'
import Audio, {
    initialAudioState,
    percentInSegmentToTimeInSegment,
    playAudioPercent,
    playAudioInMovie,
    playAudio,
    stopAudio,
    AudioState,
} from '../components/Audio'
import SpectrogramWithManyAnnotations from '../components/SpectrogramWithManyAnnotations'
import { isStateLoaded, useAnnotations, useAnnotationState } from '../hooks/useAnnotations'
import EditorAdvancedButtons from '../components/EditorAdvancedButtons'
import { DownOutlined, UserOutlined, VideoCameraOutlined } from '@ant-design/icons'
import WorkerSelector from '../components/WorkerSelector'
import { useHotkeys } from 'react-hotkeys-hook'

const { Content } = Layout
const { Paragraph } = Typography

const spectrogramAnnotationStyle: React.CSSProperties = {
    width: '100%',
    height: '85%',
    position: 'absolute',
    top: '0%',
    zIndex: 4,
}

const spectrogramStyle_: React.CSSProperties = {
    width: '100%',
    height: '85%',
    position: 'absolute',
    top: '0%',
    zIndex: 0,
}

const containerStyle: React.CSSProperties = { position: 'relative' }

export default function StatusPage() {
    const onMessageRef = useRef<(level: Types.MessageLevel, value: string) => any>(() => null)

    const [redrawState, setRedraw] = useState<{}>({})
    const [users, setUsers] = useState<string[] | null>(null)
    const [movies, setMovies] = useState<string[] | null>(null)
    const [movieWorkers, setMovieWorkers] = useState<string[] | null>(null)
    const [audioState, setAudioState] = useState<AudioState>(initialAudioState)
    const clearClickMarker = useRef<() => any>(() => null)
    const [selectedWorkers, setSelectedWorkers] = useState<string[]>([])

    const [state, setMovie, setStartTime, setDuration, setUser, setReferences, setDefaultReference] = useAnnotationState()
    const onSave = useRef(() => null)
    const onReload = useRef(() => null)

    const clearMessages = useCallback(() => onMessageRef.current!(Types.MessageLevel.closed, ''), [])

    const [annotations, setAnnotations, annotationSource] = useAnnotations(
        state.current.movie!,
        setMovie,
        state.current.startTime!,
        setStartTime,
        state.current.duration!,
        setDuration,
        state.current.user!,
        setUser,
        state.current.references!,
        setReferences,
        state.current.defaultReference!,
        setDefaultReference,
        onSave,
        onReload,
        onMessageRef,
        () => {
            clearClickMarker.current()
            setRedraw({})
        },
        false
    )

    const isReady =
        !_.isUndefined(state.current.movie) &&
        !_.isUndefined(state.current.startTime) &&
        !_.isNaN(state.current.startTime) &&
        !_.isUndefined(state.current.duration) &&
        !_.isNaN(state.current.duration)

    const load = useCallback(() => {
        Promise.all(
            _.map([`${apihost}api/worker-list`, `${apihost}api/movie-list`], (url: string) =>
                fetch(url, {
                    method: 'GET',
                    mode: 'cors',
                    cache: 'no-cache',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                }).then(res => res.json())
            )
        ).then(res => {
            setUsers(res[0])
            setMovies(res[1])
            setRedraw({})
        })
    }, [])

    useEffect(() => load(), [])

    useEffect(() => {
        if (!_.isUndefined(state.current.movie)) {
            fetch(`${apihost}api/workers-for-movie?movie=${state.current.movie}`, {
                method: 'GET',
                mode: 'cors',
                cache: 'no-cache',
                headers: {
                    'Content-Type': 'application/json',
                },
            })
                .then(res => res.json())
                .then(res => {
                    const sorted = res.sort((a: string, b: string) => {
                        const a_ = a.toLowerCase()
                        const b_ = b.toLowerCase()
                        if (_.includes(users, a) && !_.includes(users, b)) return 1
                        if (!_.includes(users, a) && _.includes(users, b)) return -1
                        if (a_ === b_) return 0
                        if (a_ < b_) return -1
                        return 1
                    })
                    setReferences(sorted)
                    setMovieWorkers(sorted)
                })
        }
    }, [state.current.movie, users])

    useEffect(() => {
        setReferences(movieWorkers)
        onReload.current()
    }, [movieWorkers, onReload.current])

    useEffect(() => {
        onReload.current()
    }, [state.current.movie, state.current.startTime, state.current.duration])

    const onBack4s = useCallback(() => {
        clearMessages()
        clearClickMarker.current()
        setStartTime(Types.addConst(state.current.startTime!, -4))
    }, [])
    const onBack2s = useCallback(() => {
        clearMessages()
        clearClickMarker.current()
        setStartTime(Types.addConst(state.current.startTime!, -2))
    }, [])
    const onForward2s = useCallback(() => {
        clearMessages()
        clearClickMarker.current()
        setStartTime(Types.addConst(state.current.startTime!, 2))
    }, [])
    const onForward4s = useCallback(() => {
        clearMessages()
        clearClickMarker.current()
        setStartTime(Types.addConst(state.current.startTime!, 4))
    }, [])
    const onPlayFromBeginning = useCallback(() => {
        clearMessages()
        playAudio(Types.to(0), null, setAudioState)
    }, [setAudioState])
    const onStop = useCallback(() => {
        clearMessages()
        stopAudio(setAudioState)
    }, [setAudioState])

    useHotkeys('shift+b', batched(onBack4s), {}, [onBack4s])
    useHotkeys('b', batched(onBack2s), {}, [onBack2s])
    useHotkeys('f', batched(onForward2s), {}, [onForward2s])
    useHotkeys('shift+f', batched(onForward4s), {}, [onForward4s])

    return (
        <Layout className="layout">
            <PageHeader
                className="site-page-header"
                title="Annotation status"
                tags={<MessagePane onMessageRef={onMessageRef} />}
                extra={[
                    <Button
                        key="1"
                        type="primary"
                        icon={<ReloadOutlined />}
                        danger={true}
                        size="large"
                        onClick={onReload.current}
                    >
                        Reload
          </Button>,
                ]}
            ></PageHeader>
            {_.isNull(users) || _.isNull(movies) ? (
                <Spin size="large" />
            ) : (
                    <Content className="main-content">
                        <Card bordered={false}>
                            <Space size={3}>
                                <Dropdown
                                    className="movie-selector"
                                    overlay={
                                        <Menu
                                            onClick={a => {
                                                setMovie(a.key)
                                                setRedraw({})
                                            }}
                                        >
                                            {_.map(_.sortBy(movies), movie => (
                                                <Menu.Item key={movie} icon={<VideoCameraOutlined />}>
                                                    {movie}
                                                </Menu.Item>
                                            ))}
                                        </Menu>
                                    }
                                >
                                    <Button>
                                        {_.isUndefined(state.current.movie) ? 'Select movie' : state.current.movie}
                                        <DownOutlined />
                                    </Button>
                                </Dropdown>
                                <WorkerSelector workers={movieWorkers} onSelectWorker={setSelectedWorkers} />
                            </Space>
                        </Card>
                        {isReady ? (
                            <div className="spectrogram-with-annotations" style={containerStyle}>
                                <SpectrogramWithManyAnnotations
                                    movie={state.current.movie!}
                                    startTime={state.current.startTime!}
                                    duration={state.current.duration!}
                                    annotations={annotations.current}
                                    workers={selectedWorkers}
                                    audioState={audioState}
                                    setAudioState={setAudioState}
                                    clearClickMarker={clearClickMarker}
                                    onMessage={onMessageRef.current!}
                                    users={users}
                                />
                            </div>
                        ) : (
                                <></>
                            )}
                        <EditorButtons
                            onPlayFromBeginning={onPlayFromBeginning}
                            onStop={onStop}
                            onBack4s={onBack4s}
                            onBack2s={onBack2s}
                            onForward2s={onForward2s}
                            onForward4s={onForward4s}
                            simple={true}
                        />
                        <EditorAdvancedButtons
                            movie={defaulted(state.current.movie, '')}
                            setMovie={setMovie}
                            startTime={defaulted(state.current.startTime, Types.to<Types.TimeInMovie>(0))}
                            setStartTime={setStartTime}
                            duration={defaulted(state.current.duration, Types.to<Types.TimeInMovie>(4))}
                            setDuration={setDuration}
                            user={defaulted(state.current.user, '')}
                            setUser={setUser}
                            references={defaulted(state.current.references, '')}
                            setReferences={setReferences}
                            defaultReference={defaulted(state.current.defaultReference, '')}
                            setDefaultReference={setDefaultReference}
                            onMessage={onMessageRef.current!}
                        />
                    </Content>
                )}
        </Layout>
    )
}
