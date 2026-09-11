import React, { useRef, useCallback, useMemo, useEffect } from 'react';
import { useRecoilValue } from 'recoil';
import { useDrag, useDrop } from 'react-dnd';
import { LayoutGrid, Shapes } from 'lucide-react';
import { useQueries } from '@tanstack/react-query';
import { Button, Skeleton } from '@librechat/client';
import { useLocation, useNavigate } from 'react-router-dom';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { Agent, TEndpointsConfig, TModelSpec } from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';
import type { AgentQueryResult } from '~/common';
import {
  useGetConversation,
  useFavorites,
  useLocalize,
  useShowMarketplace,
  useNewConvo,
} from '~/hooks';
import { useGetEndpointsQuery, useGetStartupConfig } from '~/data-provider';
import { useAssistantsMapContext, useAgentsMapContext } from '~/Providers';
import useSelectMention from '~/hooks/Input/useSelectMention';
import FavoriteItem from './FavoriteItem';
import store from '~/store';

/** Height intentionally matches FavoriteItem (px-3 py-2 + h-5 icon) to keep the CellMeasurerCache valid across the isAgentsLoading transition. */
const FavoriteItemSkeleton = () => (
  <div className="flex w-full items-center rounded-lg px-3 py-2">
    <Skeleton className="mr-2 h-5 w-5 rounded-full" />
    <Skeleton className="h-4 w-24" />
  </div>
);

const MarketplaceSkeleton = () => (
  <div className="flex w-full items-center rounded-lg px-3 py-2">
    <Skeleton className="mr-2 h-5 w-5" />
    <Skeleton className="h-4 w-28" />
  </div>
);

interface DestinationItemProps {
  icon: LucideIcon;
  isActive: boolean;
  label: string;
  onClick: () => void;
  testId: string;
}

const DestinationItem = React.forwardRef<HTMLButtonElement, DestinationItemProps>(
  ({ icon: Icon, isActive, label, onClick, testId }, ref) => (
    <Button
      ref={ref}
      variant="ghost"
      aria-current={isActive ? 'page' : undefined}
      aria-label={label}
      className={`relative h-auto w-full justify-start rounded-lg px-3 py-2 font-normal text-text-primary ${
        isActive ? 'bg-surface-active-alt' : ''
      }`}
      onClick={onClick}
      data-testid={testId}
    >
      <Icon className="h-5 w-5 flex-shrink-0 text-text-primary" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </Button>
  ),
);

DestinationItem.displayName = 'DestinationItem';

interface DraggableFavoriteItemProps {
  id: string;
  index: number;
  moveItem: (dragIndex: number, hoverIndex: number) => void;
  onDrop: () => void;
  children: React.ReactNode;
}

const DraggableFavoriteItem = ({
  id,
  index,
  moveItem,
  onDrop,
  children,
}: DraggableFavoriteItemProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [{ handlerId }, drop] = useDrop<{ index: number; id: string }, unknown, { handlerId: any }>(
    {
      accept: 'favorite-item',
      collect(monitor) {
        return {
          handlerId: monitor.getHandlerId(),
        };
      },
      hover(item, monitor) {
        if (!ref.current) {
          return;
        }
        const dragIndex = item.index;
        const hoverIndex = index;

        if (dragIndex === hoverIndex) {
          return;
        }

        const hoverBoundingRect = ref.current?.getBoundingClientRect();
        const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
        const clientOffset = monitor.getClientOffset();
        if (!clientOffset) {
          return;
        }
        const hoverClientY = clientOffset.y - hoverBoundingRect.top;

        if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) {
          return;
        }

        if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) {
          return;
        }

        moveItem(dragIndex, hoverIndex);
        item.index = hoverIndex;
      },
    },
  );

  const [{ isDragging }, drag] = useDrag({
    type: 'favorite-item',
    item: () => {
      return { id, index };
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
    end: () => {
      onDrop();
    },
  });

  const opacity = isDragging ? 0 : 1;
  drag(drop(ref));

  return (
    <div ref={ref} style={{ opacity }} data-handler-id={handlerId}>
      {children}
    </div>
  );
};

export default function FavoritesList({
  isSmallScreen,
  toggleNav,
}: {
  isSmallScreen?: boolean;
  toggleNav?: () => void;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const localize = useLocalize();
  const search = useRecoilValue(store.search);
  const getConversation = useGetConversation(0);
  const { favorites, reorderFavorites, isLoading: isFavoritesLoading } = useFavorites();
  const showAgentMarketplace = useShowMarketplace();

  const { newConversation } = useNewConvo();
  const assistantsMap = useAssistantsMapContext();
  const agentsMap = useAgentsMapContext();
  const { data: endpointsConfig = {} as TEndpointsConfig } = useGetEndpointsQuery();
  const { data: startupConfig } = useGetStartupConfig();

  const modelSpecs = useMemo(
    () => startupConfig?.modelSpecs?.list ?? [],
    [startupConfig?.modelSpecs?.list],
  );

  const specsMap = useMemo(() => {
    const map: Record<string, TModelSpec> = {};
    for (const spec of modelSpecs) {
      map[spec.name] = spec;
    }
    return map;
  }, [modelSpecs]);

  const { onSelectEndpoint: _onSelectEndpoint, onSelectSpec: _onSelectSpec } = useSelectMention({
    modelSpecs,
    assistantsMap,
    endpointsConfig,
    getConversation,
    newConversation,
    returnHandlers: true,
  });

  const onSelectEndpoint = useCallback(
    (...args: Parameters<NonNullable<typeof _onSelectEndpoint>>) => {
      _onSelectEndpoint?.(...args);
      if (isSmallScreen && toggleNav) {
        toggleNav();
      }
    },
    [_onSelectEndpoint, isSmallScreen, toggleNav],
  );

  const onSelectSpec = useCallback(
    (...args: Parameters<NonNullable<typeof _onSelectSpec>>) => {
      _onSelectSpec?.(...args);
      if (isSmallScreen && toggleNav) {
        toggleNav();
      }
    },
    [_onSelectSpec, isSmallScreen, toggleNav],
  );

  const marketplaceRef = useRef<HTMLButtonElement>(null);
  const artifactAppsRef = useRef<HTMLButtonElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);

  const handleAgentMarketplace = useCallback(() => {
    navigate('/agents');
    if (isSmallScreen && toggleNav) {
      toggleNav();
    }
  }, [navigate, isSmallScreen, toggleNav]);

  const handleArtifactApps = useCallback(() => {
    navigate('/apps');
    if (isSmallScreen && toggleNav) {
      toggleNav();
    }
  }, [navigate, isSmallScreen, toggleNav]);

  const artifactAppsItem = (
    <DestinationItem
      ref={artifactAppsRef}
      icon={Shapes}
      isActive={pathname === '/apps' || pathname.startsWith('/apps/')}
      label={localize('com_nav_artifact_apps')}
      onClick={handleArtifactApps}
      testId="nav-artifact-apps-button"
    />
  );

  const handleRemoveFocus = useCallback(() => {
    if (marketplaceRef.current) {
      marketplaceRef.current.focus();
      return;
    }
    if (artifactAppsRef.current) {
      artifactAppsRef.current.focus();
      return;
    }
    const nextFavorite = listContainerRef.current?.querySelector<HTMLElement>(
      '[data-testid="favorite-item"]',
    );
    if (nextFavorite) {
      nextFavorite.focus();
      return;
    }
    const newChatButton = document.querySelector<HTMLElement>(
      '[data-testid="nav-new-chat-button"]',
    );
    newChatButton?.focus();
  }, []);

  const safeFavorites = useMemo(() => (Array.isArray(favorites) ? favorites : []), [favorites]);

  const allAgentIds = useMemo(
    () => safeFavorites.map((f) => f.agentId).filter(Boolean) as string[],
    [safeFavorites],
  );

  const missingAgentIds = useMemo(() => {
    if (agentsMap === undefined) {
      return [];
    }
    return allAgentIds.filter((id) => !agentsMap[id]);
  }, [allAgentIds, agentsMap]);

  const missingAgentQueries = useQueries({
    queries: missingAgentIds.map((agentId) => ({
      queryKey: [QueryKeys.agent, agentId],
      queryFn: async (): Promise<AgentQueryResult> => {
        try {
          const agent = await dataService.getAgentById({ agent_id: agentId });
          return { found: true, agent };
        } catch (error) {
          if (error && typeof error === 'object' && 'response' in error) {
            const axiosError = error as { response?: { status?: number } };
            const status = axiosError.response?.status;
            if (status === 404 || status === 403) {
              return { found: false };
            }
          }
          throw error;
        }
      },
      staleTime: 1000 * 60 * 5,
    })),
  });

  const staleAgentIdsKey = useMemo(() => {
    const ids: string[] = [];
    for (let i = 0; i < missingAgentIds.length; i++) {
      const query = missingAgentQueries[i];
      if (query.data && !query.data.found) {
        ids.push(missingAgentIds[i]);
      }
    }
    return ids.sort().join(',');
  }, [missingAgentIds, missingAgentQueries]);

  const cleanupAttemptedRef = useRef('');

  useEffect(() => {
    if (!staleAgentIdsKey || cleanupAttemptedRef.current === staleAgentIdsKey) {
      return;
    }
    const staleSet = new Set(staleAgentIdsKey.split(','));
    const cleaned = safeFavorites.filter((f) => !f.agentId || !staleSet.has(f.agentId));
    if (cleaned.length < safeFavorites.length) {
      cleanupAttemptedRef.current = staleAgentIdsKey;
      reorderFavorites(cleaned, true);
    }
  }, [staleAgentIdsKey, safeFavorites, reorderFavorites]);

  const staleSpecNamesKey = useMemo(() => {
    if (startupConfig === undefined) {
      return '';
    }
    return safeFavorites
      .filter((f) => f.spec && !specsMap[f.spec])
      .map((f) => f.spec as string)
      .sort()
      .join(',');
  }, [safeFavorites, specsMap, startupConfig]);

  const specCleanupAttemptedRef = useRef('');

  useEffect(() => {
    if (!staleSpecNamesKey || specCleanupAttemptedRef.current === staleSpecNamesKey) {
      return;
    }
    const staleSet = new Set(staleSpecNamesKey.split(','));
    const cleaned = safeFavorites.filter((f) => !f.spec || !staleSet.has(f.spec));
    if (cleaned.length < safeFavorites.length) {
      specCleanupAttemptedRef.current = staleSpecNamesKey;
      reorderFavorites(cleaned, true);
    }
  }, [staleSpecNamesKey, safeFavorites, reorderFavorites]);

  const combinedAgentsMap = useMemo(() => {
    if (agentsMap === undefined) {
      return undefined;
    }
    const combined: Record<string, Agent> = {};
    for (const [key, value] of Object.entries(agentsMap)) {
      if (value) {
        combined[key] = value;
      }
    }
    missingAgentQueries.forEach((query) => {
      if (query.data?.found) {
        combined[query.data.agent.id] = query.data.agent;
      }
    });
    return combined;
  }, [agentsMap, missingAgentQueries]);

  const isAgentsLoading =
    (allAgentIds.length > 0 && agentsMap === undefined) ||
    (missingAgentIds.length > 0 && missingAgentQueries.some((q) => q.isLoading));

  const draggedFavoritesRef = useRef(safeFavorites);

  const moveItem = useCallback(
    (dragIndex: number, hoverIndex: number) => {
      const newFavorites = [...draggedFavoritesRef.current];
      const [draggedItem] = newFavorites.splice(dragIndex, 1);
      newFavorites.splice(hoverIndex, 0, draggedItem);
      draggedFavoritesRef.current = newFavorites;
      reorderFavorites(newFavorites, false);
    },
    [reorderFavorites],
  );

  const handleDrop = useCallback(() => {
    // Persist the final order using the ref which has the latest state
    reorderFavorites(draggedFavoritesRef.current, true);
  }, [reorderFavorites]);

  // Keep ref in sync when favorites change from external sources
  useEffect(() => {
    draggedFavoritesRef.current = safeFavorites;
  }, [safeFavorites]);

  if (search.query) {
    return null;
  }

  if (isFavoritesLoading) {
    return (
      <div className="mb-2 flex flex-col pb-2">
        <div className="mt-1 flex flex-col gap-1">
          {showAgentMarketplace && <MarketplaceSkeleton />}
          {artifactAppsItem}
          <FavoriteItemSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="mb-2 flex flex-col">
      <div ref={listContainerRef} className="mt-1 flex flex-col gap-1">
        {/* Show skeletons for ALL items while agents are still loading */}
        {isAgentsLoading ? (
          <>
            {/* Marketplace skeleton */}
            {showAgentMarketplace && <MarketplaceSkeleton />}
            {artifactAppsItem}
            {/* Favorite items skeletons */}
            {safeFavorites.map((_, index) => (
              <FavoriteItemSkeleton key={`skeleton-${index}`} />
            ))}
          </>
        ) : (
          <>
            {/* Agent Marketplace button */}
            {showAgentMarketplace && (
              <DestinationItem
                ref={marketplaceRef}
                icon={LayoutGrid}
                isActive={pathname === '/agents' || pathname.startsWith('/agents/')}
                label={localize('com_agents_marketplace')}
                onClick={handleAgentMarketplace}
                testId="nav-agents-marketplace-button"
              />
            )}
            {artifactAppsItem}
            {safeFavorites.map((fav, index) => {
              if (fav.agentId) {
                const agent = combinedAgentsMap?.[fav.agentId];
                if (!agent) {
                  return null;
                }
                return (
                  <DraggableFavoriteItem
                    key={fav.agentId}
                    id={fav.agentId}
                    index={index}
                    moveItem={moveItem}
                    onDrop={handleDrop}
                  >
                    <FavoriteItem
                      item={agent}
                      type="agent"
                      onSelectEndpoint={onSelectEndpoint}
                      onRemoveFocus={handleRemoveFocus}
                    />
                  </DraggableFavoriteItem>
                );
              } else if (fav.spec) {
                const spec = specsMap[fav.spec];
                if (!spec) {
                  return null;
                }
                return (
                  <DraggableFavoriteItem
                    key={`spec-${fav.spec}`}
                    id={`spec-${fav.spec}`}
                    index={index}
                    moveItem={moveItem}
                    onDrop={handleDrop}
                  >
                    <FavoriteItem
                      item={spec}
                      type="spec"
                      onSelectSpec={onSelectSpec}
                      onRemoveFocus={handleRemoveFocus}
                      endpointsConfig={endpointsConfig}
                    />
                  </DraggableFavoriteItem>
                );
              } else if (fav.model && fav.endpoint) {
                return (
                  <DraggableFavoriteItem
                    key={`${fav.endpoint}-${fav.model}`}
                    id={`${fav.endpoint}-${fav.model}`}
                    index={index}
                    moveItem={moveItem}
                    onDrop={handleDrop}
                  >
                    <FavoriteItem
                      item={{ model: fav.model, endpoint: fav.endpoint }}
                      type="model"
                      onSelectEndpoint={onSelectEndpoint}
                      onRemoveFocus={handleRemoveFocus}
                    />
                  </DraggableFavoriteItem>
                );
              }
              return null;
            })}
          </>
        )}
      </div>
    </div>
  );
}
